# Why ClubOS was slow, measured (2026-09-15)

Daniel: *"our clubos seems to be very slow at loading especially related to database and needs to
be way faster to match best software in world industry standard."*

🔴 **Measured, never guessed** — `pg_stat_statements` for cost, `EXPLAIN` for cause, real
signed-in endpoint timings for what a human actually feels. The codebase's own precedent: the last
search fix had two plausible guesses that were both real improvements and *neither* was the cause.

## 🟢 FIXED — the People page, 4.1s → 178ms (22.9×)

**Two missing indexes.** `/api/admin/people`, `/api/admin/registrations` and `/api/admin/contacts`
all share `contactHiddenSql()` — the "if you ain't paid you ain't registered" filter. It runs TWO
correlated `EXISTS` per contact, each keyed `(r.contact_id = c.id OR r.guardian_id = c.id)`, and
**`registrations` carried no index on either column**. EXPLAIN showed a Seq Scan on `registrations`
executed once per contact (`loops=54` for a LIMIT 50) and a planner cost of **1,552,773** for the
unbounded form the People page runs.

🔴 **Two indexes, not one.** An `OR` across two different columns cannot use a single index; with
one on each, Postgres BitmapOrs them. `status` is the second column because every use of the
predicate filters on it.

| endpoint | before | after | |
|---|---|---|---|
| `/api/admin/people?limit=50` | 4,079 ms | **178 ms** | 22.9× |
| `/api/admin/registrations?limit=50` | 1,502 ms | 810 ms | 1.9× |
| `/api/admin/contacts?limit=50` | 1,156 ms | 761 ms | 1.5× |

Applied by `script/apply-people-perf-indexes.ts` (dry-run default; it refuses to claim success
without re-checking the PLAN, because an index that doesn't change the plan has fixed nothing).
**A database change, so it was live immediately — no deploy.**

## ⏳ Still slow, and what's underneath

1. **`registrations` and `contacts` are still ~800ms.** The shared predicate is fixed, so there is a
   SECOND cause in those two endpoints specifically. Not yet diagnosed.
2. 🔴 **`email_logs` is 3,337 MB — for 11,351 rows.** `body` alone is **3,184 MB**: the full HTML of
   every transactional email, averaging **287 KB** each, largest 1.19 MB. It is 18× bigger than
   every other table combined. Worse, `getEmailLogByRegistration()` does `db.select()` — `SELECT *`,
   including that body — so any caller drags ~287 KB across the wire. Decide what the body is for;
   if it is only ever an audit trail, it belongs in object storage or truncated after N days.
3. **The bot-flag cron is 36.8% of ALL database time** — 865 seconds across 285 calls, 3.0s each
   (`backfillBotFlags` in `server/attribution-maintenance-cron.ts`). ⚠️ It is a BACKGROUND job, so
   fixing it frees capacity rather than speeding up a page. Its plan is fine; the cost is updating
   ~6,500 rows on a table carrying **ten** indexes, re-scanning the same window every run.
4. **`analytics_events`: 303k rows, 179 MB, TEN indexes** — and it takes ~18,000 inserts. Every
   insert maintains all ten. Worth auditing which are actually used (`pg_stat_user_indexes`).
5. **Attribution/Marketing queries at 2.9–4.0s** (`WITH pv AS … regexp_replace(landing_url …)`).
   The Marketing Hub session reports having taken their traffic query 5s → 0.8s; the remaining
   `pv` variants are worth the same treatment.
6. **Global search** (`WITH found AS …`) runs 688–1,312 ms per call in production, on every
   keystroke. Same `contactHiddenSql` root, so it should have improved — re-measure.

## ⚠️ Self-inflicted noise in the numbers

Two of the top-15 costliest statements are MINE, not the app's: `DELETE FROM users WHERE id=$1`
(166 calls, 490ms avg — probe cleanup, slow because of the audit FKs) and the
`information_schema.table_constraints` lookups (5.8–6.5s each — the contact-merge script's FK
enumeration). Neither affects a page load. Discount them when reading pg_stat_statements.

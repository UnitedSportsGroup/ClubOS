# ClubOS Migration — Cutover Plan

Migration from Replit → Supabase + Fly.io. This doc lives until Replit is cancelled, then it gets archived.

## Where we are

| Component | Status |
|---|---|
| Custom domain | `app.usg.co.nz` live, TLS issued |
| Fly app | `clubos.fly.dev` (also `app.usg.co.nz`), 2 machines, syd region |
| Database | Supabase Postgres (Sydney), 38,566 rows synced exactly from prod Neon |
| File storage | Supabase Storage bucket `clubos-uploads`, 11 files migrated (6 webp + 5 avif siblings) |
| Stripe webhook | Parallel-run: both Replit endpoint AND new `https://app.usg.co.nz/api/stripe/webhook` are active |
| Auth | Daniel (`daniel@cufc.co.nz`) verified working, case-insensitive |
| DNS | Auckland not available on this Fly account; running in Sydney instead |

## Pre-cutover checklist

Tick these as we verify them on `app.usg.co.nz`. Anything failing means we hold the cutover.

### Smoke-test the live admin app

- [ ] Log in as `daniel@cufc.co.nz` — works
- [ ] Dashboard shows correct totals (~221 parents, 318 registrations, ~$22.7k revenue)
- [ ] **Facilities page** — all 4 facilities render images
- [ ] **Calendar** — events showing across CUFC, SIU, MFL, etc. (matches Replit)
- [ ] **Camps page** — both holiday camps appear, dates/pricing correct
- [ ] **Registrations** — list loads, individual registration shows children + items
- [ ] **Tournaments** — CIC tournaments show with all teams + games + groups
- [ ] **Leagues** (MFL) — Saturday Morning + Friday Futsal competitions, divisions, teams visible
- [ ] **Bookings calendar** (venue) — shows correctly even if no bookings
- [ ] **Settings** — club info, email, phone correct
- [ ] **People & access** (admin users) — Daniel + Grassroots + Marketing visible

### Critical money path

The booking → payment → confirmation flow is what actually pays the bills. Test end-to-end:

- [ ] Create a real test booking on `app.usg.co.nz` for a small amount (or use an active camp date)
- [ ] Stripe Checkout opens, payment goes through (use real card or refund yourself)
- [ ] Stripe webhook fires → Fly app receives `checkout.session.completed`, updates booking → status: confirmed
- [ ] Confirmation email arrives (Resend)
- [ ] Booking appears in admin dashboard
- [ ] Meta Pixel events fire correctly (check Meta Events Manager)
- [ ] If refunding: `charge.refunded` event handled (only if subscribed — currently we are NOT)

### Emails

- [ ] Trigger a confirmation email (booking confirmation)
- [ ] Verify it arrives from `info@cufc.co.nz` (Resend FROM address)
- [ ] Email logs row created in `email_logs` table

### Public-facing pages

- [ ] Camp landing pages load (slug URLs like `/fundamentals-camp`)
- [ ] Booking flow works end-to-end without login (parents shouldn't need accounts)

### Image / file uploads

- [ ] Upload a new facility image — saves, displays
- [ ] Verify it lands in Supabase Storage bucket (not Replit)

### What you'll lose by cancelling Replit

- The `clubbase.replit.app` subdomain — anyone with that URL bookmarked needs to be redirected
- The `join.cufc.co.nz` redirect (currently pointing at Replit) — needs to be re-pointed to `app.usg.co.nz` BEFORE cancellation
- Replit Object Storage files — only 6 (10 with siblings) referenced in DB, all migrated; any orphan files not referenced in DB will be lost
- The old `STRIPE_WEBHOOK_SECRET` — once Replit endpoint is deleted, that secret is dead

## Cutover sequence (when ready)

1. **Re-point `join.cufc.co.nz`** at Fly. In GoDaddy, change the CNAME for `join.cufc.co.nz` to point to `app.usg.co.nz`. Add cert: `fly certs add join.cufc.co.nz --app clubos`. Wait for cert + DNS propagation (~10–60 min).
2. **One last data sync.** `PROD_DATABASE_URL=... npx tsx script/sync-prod-to-supabase.ts` — captures any bookings that came in since the last sync.
3. **Verify** counts match again with `compare-prod-vs-supabase.ts`.
4. **Disable the old Stripe webhook** at Replit URL (in Stripe dashboard, click into `cufc-clubbase` → Disable). All future webhooks go to Fly only.
5. **Delete the Replit deployment** (or just stop it — you can keep the project for the bucket files for a week longer if paranoid).
6. **Cancel Replit subscription.**
7. **Rotate prod Neon credentials** (the URL with the password is in shell history + `.env` files — even though Neon will be unused, rotate for hygiene). Delete the Neon project entirely once you're sure.

## Rollback plan (if something breaks during cutover)

- **DNS rollback**: change `app.usg.co.nz` CNAME at GoDaddy back to Replit's URL. Same for `join.cufc.co.nz`.
- **Stripe rollback**: re-enable old webhook in Stripe.
- Replit code is still running and reads from prod Neon (not Supabase). It would just immediately resume serving once DNS rolls back.
- The Supabase + Fly stack is separate and won't be affected.

## Known issues / nice-to-haves (post-cutover)

- [ ] Move Fly app to Auckland once available on this account (currently Sydney, ~25-30ms vs ~5ms)
- [ ] Set up `daniel@usg.co.nz` and other email addresses on the new domain
- [ ] Consider Cloudflare in front of `usg.co.nz` for analytics + edge cache + automated DNS
- [ ] GitHub: accept the `UnitedSportsGroup/ClubOS` collaborator invite for `DanielMeyn` so local commits can push
- [ ] Subscribe Stripe webhook to `charge.refunded` if refunds need automation (currently only `checkout.session.completed`)
- [ ] Address the constant `analytics_events_pkey` constraint violations in Fly logs (public analytics endpoint is double-firing for same event ID — cosmetic, no data loss)

## Operational scripts (in `script/`)

- `sync-prod-to-supabase.ts` — full DB sync from Neon → Supabase. Idempotent.
- `compare-prod-vs-supabase.ts` — table-by-table row-count diff.
- `audit-supabase.ts` — quick Supabase health check.
- `migrate-files-from-replit.ts` — file migration. `--backfill-avif` for AVIF siblings only.
- `setup-supabase-storage.ts` — bucket creation + round-trip test.
- `find-file-refs.ts` — scans DB for media references.
- `find-demo-data.ts` / `delete-demo-contacts.ts` — already run, demo data purged.

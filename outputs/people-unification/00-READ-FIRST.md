# One person, one record, all four systems (2026-09-11)

Daniel: *"clean up this shopify data and then we should have a full unification, migration and
merge between all of our databases of all time — clubos, fm, xero, and shopify."*

## 🟢 What is already unified

Every system's money is already in ClubOS, keyed on `contacts`, going back to 2017:

| Source | Payments | People | Money | Range |
|---|---|---|---|---|
| Xero | 17,795 | 2,730 | **$4,170,700** | Feb 2017 → Sep 2026 |
| Friendly Manager | 8,072 | 2,361 | **$1,117,269** | Aug 2017 → Jul 2026 |
| Shopify | 1,552 | 772 | **$95,730** | Jan 2023 → Jan 2026 |
| live ClubOS registrations | 1,589 | 937 | $503,556 | |

**$5,383,699.18 total, and the merge did not change it by a cent** — payments were repointed, never
edited.

## 🟢 Done today — the duplicate people

The Shopify import created a contact **per ORDER, not per child**: Xan Nuthall existed six times,
Vinn Hill twelve. 564 of the 745 records inside a duplicate group carried `shopify-import`.

**279 duplicate groups → 39.** 240 merged, 445 records retired, 1,021 rows repointed, in 14 seconds.
Shopify people 1,114 → 772. **0 live registrations changed** — identity and history, not counts.

Retired, never deleted: each points at the record that absorbed it, stamped with who and when, and
all 3,716 affected rows were snapshotted first (`outputs/contact-merges/before-auto.json`).

## 🔴 39 groups HELD BACK — a human has to settle these

Nothing ambiguous was applied.

- **38 groups hold two different dates of birth.** Age grade is `seasonYear − birthYear`, so
  choosing one decides which session a child trains in. Worst: `charlie salmond` (9 records),
  `darren zhang` (7), `parum shridhar` (6), `george meates` (5).
- **2 groups hold two different Friendly Manager ids** (`cooper caldwell` 40692/41054,
  `rudraksh rawat` 3155/39596). FM itself treated them as two people — a stronger claim than a
  matching name. They may genuinely be two children.

Full list: `outputs/contact-merges/held-for-a-human.json`.

## 🔴 59 field conflicts kept, not overwritten

Mostly **consent flags** (34 photo, 22 medical). The rule: keep the surviving record's value — it is
the record whose form was actually filled in — and report. Worth a look:

- **kaleb nathan** is the ONLY case where a `false` was kept over a `true` (photo and medical).
  Keeping the restrictive value is the safe direction for a child, but somebody should confirm it.
- Every other consent case keeps `true` over an import's default `false`. **That `false` is the
  absence of an answer, not a refusal** — which is why it must never overwrite a recorded yes.

Full list: `outputs/contact-merges/conflicts.txt`.

## ⏳ What is genuinely still missing

1. **Registrations for 2017–2025.** The money is all in; the ENROLMENTS are not. Live registrations
   exist only for 2026 (1,234). Every prior year reads 0 against real Xero money:
   2022 $376,872 · 2023 $405,387 · 2024 $595,305 · 2025 $797,182. The 2026 pass derived term and
   programme from the invoice reference wording, so the same method extends backwards — the single
   biggest remaining piece.
2. **429 payments are attached to no person at all.**
3. **~50 payments carry a nonsense `season_year`** (2031–2099) — the year was parsed out of an
   invoice reference containing a number. Small amounts, but they land in the wrong year on any
   report. A parsing fix plus a re-derive.
4. **Duplicate GUARDIANS are untouched.** Nilu Nuthall exists twice (`2101.zealand@gmail.com` and
   `paper.nilufar@gmail.com`). Deliberate: a guardian can have several children, so the blast radius
   is larger than a child's.
5. **Luca Murdoch has no FUNiño Term 3 registration** despite paying `INV-17070 "FS 2026 - Term 3
   (Multi-Sport Family Credit)"`, 3 × $30 so far. Olga's call, and it would make FUNiño Term 3 150.

## 🔴 Four traps this work hit, all caught before anything was applied

Read these before the next bulk data job on this database:

- **A migration inside a long transaction freezes the app.** `ALTER TABLE contacts` takes an ACCESS
  EXCLUSIVE lock held until commit — even `ADD COLUMN IF NOT EXISTS` on a column that already
  exists. Run schema changes on their own, first.
- **A statement per row is a round-trip bill.** 512 pairs × 26 foreign keys ≈ 27,000 queries; at the
  ~90ms this link actually costs, over an hour — and the pooler killed the connection mid-run. Bulk
  SQL against a mapping table: ~70 statements, 14 seconds.
- **A `VALUES` list types its parameters as text**, so a COALESCE onto an enum column fails. Read
  the column types rather than special-casing the one that breaks.
- **A collision guard must compare against the RESULT, not the survivor.** A child merged from
  twelve records has twelve links to one parent, and they collide with each other.

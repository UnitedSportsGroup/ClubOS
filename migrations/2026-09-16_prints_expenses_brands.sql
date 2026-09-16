-- United Prints, 2026-09-16, sitting with Dima.
--
-- 1. What an expense was FOR, so the shop can report on it.
-- 2. Two fields the Apparel NZ proposal form asks for and ours did not.

-- ── Which brand(s) an expense was for ───────────────────────────────────────
-- Daniel: "allow him to breakdown and select what it's for like cic, cufc, siu,
-- united prints, mfl etc... then we'll be able to have a view how much was spent
-- on what for reporting."
--
-- 🔴 An ALLOCATION, not a single brand column. The very first row on Dima's
-- screen is "CEC 2026 and CIC S7s trophies" — one $1,320 invoice covering two
-- brands. A single brand would have to put all of it on one of them, and every
-- report built on that would be wrong. One row per brand per expense, with the
-- amount; a normal single-brand expense is just an allocation of one row.
--
-- 🔴 An expense with NO allocation reads "not allocated" and is never quietly
-- assigned. The six expenses already on file were entered before anybody was
-- asked what they were for, and a default would invent an answer.
CREATE TABLE IF NOT EXISTS print_expense_allocations (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  expense_id    integer NOT NULL REFERENCES print_expenses(id) ON DELETE CASCADE,
  brand         text    NOT NULL,
  amount_cents  integer NOT NULL,
  created_at    timestamp NOT NULL DEFAULT now(),
  -- Money against a brand is money. Zero says nothing and negative is nonsense.
  CONSTRAINT print_expense_allocations_amount_chk CHECK (amount_cents > 0)
);

-- One line per brand per expense. Two lines for the same brand is a split that
-- should have been one number, and it would double-count in every report.
CREATE UNIQUE INDEX IF NOT EXISTS print_expense_allocations_one_per_brand
  ON print_expense_allocations (expense_id, brand);

-- 🔴 A new table defaults to RLS OFF, and a Supabase anon key is public by
-- design — off + public key is the world reading the shop's spending. Our apps
-- connect as service-role and bypass it; this is the second wall that catches a
-- leaked key. The guard (scripts/security/rls_guard.mjs) caught this table
-- missing it, which is exactly what it is for.
ALTER TABLE print_expense_allocations ENABLE ROW LEVEL SECURITY;

-- The report groups by brand, and the editor loads by expense.
CREATE INDEX IF NOT EXISTS print_expense_allocations_expense_idx
  ON print_expense_allocations (expense_id);

-- ── Two fields the Apparel NZ form asks for ─────────────────────────────────
-- Daniel sent Blake Bamford's proposal form as the shape to follow. Both are
-- nullable: an existing quote genuinely does not have them.
ALTER TABLE print_quotes
  ADD COLUMN IF NOT EXISTS customer_company text,
  ADD COLUMN IF NOT EXISTS heard_about      text;

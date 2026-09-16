-- Paying a Chinese supplier, 2026-09-16.
--
-- Daniel: "allow him to select currency paid in — for example a lot of payments
-- go to china, he would go in, select yuan and enter amount" … "and maybe in
-- brackets put in the nzd rate with ~ for the conversion on that date, and
-- obviously we have exact accurate numbers in xero and anz when paid."
--
-- 🔴 THAT LAST SENTENCE IS THE DESIGN. What Dima knows is the invoice: ¥1,500.
-- What the club is actually out is whatever ANZ settled the card at, including
-- their margin, and only the bank and Xero know it. So the FOREIGN amount is
-- the recorded FACT and the NZD figure beside it is an ESTIMATE that must be
-- labelled one. Storing a converted number as if it were the truth is how a
-- ledger quietly stops matching the bank.
ALTER TABLE print_expenses
  -- What the invoice was actually in. NZD for almost everything.
  ADD COLUMN IF NOT EXISTS currency          text NOT NULL DEFAULT 'NZD',
  -- The amount in THAT currency, in minor units. NULL when the invoice is NZD —
  -- there is nothing to convert and total_cents already says it.
  ADD COLUMN IF NOT EXISTS foreign_cents     integer,
  -- The rate used, the day it was for, and where it came from. All three, or
  -- none: a rate with no date and no source cannot be checked by anybody later.
  ADD COLUMN IF NOT EXISTS fx_rate           numeric(18,8),
  ADD COLUMN IF NOT EXISTS fx_rate_on        date,
  ADD COLUMN IF NOT EXISTS fx_source         text;

-- A foreign amount without a currency, or a currency of NZD with a foreign
-- amount, are both nonsense.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'print_expenses_fx_chk') THEN
    ALTER TABLE print_expenses ADD CONSTRAINT print_expenses_fx_chk
      CHECK ((currency = 'NZD' AND foreign_cents IS NULL)
          OR (currency <> 'NZD' AND foreign_cents IS NOT NULL AND foreign_cents > 0));
  END IF;
END $$;

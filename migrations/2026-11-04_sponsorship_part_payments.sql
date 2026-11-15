-- Sponsorship Partners: an instalment can be PART paid.
-- Formosa's Year 3 is $4,600 and they are paying $420 a month; the 23 Oct
-- constraint only allowed "nothing" or "paid in full with a date", so a part
-- payment could only be stored as a lie. Now: paid_cents may carry money with
-- no paid_on (still open, only the remainder is owed); a paid_on still always
-- carries what was paid. Loosening only — every existing row already passes.
alter table sponsorship_partner_payments drop constraint if exists sponsorship_partner_payments_paid_chk;
alter table sponsorship_partner_payments add constraint sponsorship_partner_payments_paid_chk check (
  (paid_cents is null or paid_cents >= 0) and (paid_on is null or paid_cents is not null)
);

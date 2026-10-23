-- Why a released venue slot was released. Vocabulary in shared/venue-booking-truth.ts:
--   abandoned · card_declined · player_pay_expired · player_pay_cancelled · paid_slot_conflict
-- Nullable, no default: a default would be a claim about why a customer did not pay.
-- Applied by script/apply-venue-booking-truth.ts --commit (which also repairs the
-- bookings the old sweep wrongly released and backfills reasons it can justify).
ALTER TABLE facility_bookings ADD COLUMN IF NOT EXISTS cancel_reason text;

-- CIC 2027 packages: overseas teams say whether they need visa support
-- (Daniel, 26 Nov 2026). NULL = not asked (not an overseas team, or booked before
-- the question existed) — never read as "no".
ALTER TABLE cic_pkg_bookings ADD COLUMN IF NOT EXISTS visa_support boolean;

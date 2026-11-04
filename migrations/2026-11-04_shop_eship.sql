-- NZ Post eShip (Starshipit) for the club shops, 4 Nov 2026.
-- A paid delivery order is pushed into eShip, Dima prints the label there as
-- he did with Shopify, and the tracking number comes back onto the order.
-- All columns nullable, no defaults: an order that predates this was never
-- sent to eShip, which is a different fact from "sent and failed".
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS eship_order_id bigint;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS eship_claimed_at timestamptz;   -- a push in flight (one machine at a time)
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS eship_pushed_at timestamptz;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS eship_error text;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS eship_attempts integer;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_carrier text;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_status text;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_updated_at timestamptz;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipped_email_sent_at timestamptz;
-- One eShip order per shop order, ever.
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_eship_order_id_uq ON shop_orders (eship_order_id) WHERE eship_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_orders_eship_pending_idx ON shop_orders (paid_at) WHERE eship_order_id IS NULL AND address_line1 IS NOT NULL;

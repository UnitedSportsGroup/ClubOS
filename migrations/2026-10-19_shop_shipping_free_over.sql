-- Free delivery over a threshold (SIU Shopify parity: "Spend over $200 to get free NZ shipping").
-- Additive and nullable: NULL = delivery is never free, which is every existing option.
ALTER TABLE shop_shipping_options ADD COLUMN IF NOT EXISTS free_over_cents integer;
ALTER TABLE shop_shipping_options DROP CONSTRAINT IF EXISTS shop_shipping_free_over_positive;
ALTER TABLE shop_shipping_options ADD CONSTRAINT shop_shipping_free_over_positive CHECK (free_over_cents IS NULL OR free_over_cents > 0);

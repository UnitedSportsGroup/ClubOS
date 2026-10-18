-- A team photo or kit sold at the counter (POS) becomes a Store order, so the
-- Store's Orders and Sales show every sale, wherever it was paid, and a photo
-- bought at the office gets the same download link as one bought online.
-- One Store order per (till sale, brand): the unique index makes a second
-- fulfilment a no-op instead of a duplicate order. RESTRICT: a till sale with
-- a Store order behind it must never be deleted out from under it.
ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS pos_sale_id integer REFERENCES pos_sales(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_pos_sale_org_uniq
  ON shop_orders (pos_sale_id, organization_id) WHERE pos_sale_id IS NOT NULL;

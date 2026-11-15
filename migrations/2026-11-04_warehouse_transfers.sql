-- Warehouse transfers (2026-11-04). ADDITIVE ONLY.
-- Daniel: copy Shopify 1:1 — a Products tab and a Transfers tab, built stage
-- by stage. A transfer is a DOCUMENT (#T0001, from → to, lines, who, note);
-- the stock itself still moves only through the append-only wh_movements
-- ledger, as one movement group tagged ref_kind 'transfer' / ref_id = id.
-- Status is 'draft' (nothing moved) or 'transferred' (moved, stamped).

CREATE TABLE IF NOT EXISTS wh_transfers (
  id                      serial PRIMARY KEY,
  origin_location_id      integer NOT NULL REFERENCES wh_locations(id) ON DELETE RESTRICT,
  destination_location_id integer NOT NULL REFERENCES wh_locations(id) ON DELETE RESTRICT,
  reference               text,
  note                    text,
  status                  text NOT NULL DEFAULT 'draft',
  created_by_user_id      integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),
  transferred_at          timestamptz,
  transferred_by_user_id  integer REFERENCES users(id) ON DELETE RESTRICT,
  movement_group_id       text,
  CONSTRAINT wh_transfers_distinct_ends_chk CHECK (origin_location_id <> destination_location_id),
  CONSTRAINT wh_transfers_status_chk CHECK (status IN ('draft', 'transferred')),
  -- transferred ⇔ stamped with when, by whom and the ledger group it posted
  CONSTRAINT wh_transfers_stamp_chk CHECK (
    (status = 'transferred') = (transferred_at IS NOT NULL AND transferred_by_user_id IS NOT NULL AND movement_group_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS wh_transfer_lines (
  id          serial PRIMARY KEY,
  transfer_id integer NOT NULL REFERENCES wh_transfers(id) ON DELETE CASCADE,
  item_id     integer NOT NULL REFERENCES wh_items(id) ON DELETE RESTRICT,
  qty         numeric(12,3) NOT NULL,
  CONSTRAINT wh_transfer_lines_qty_chk CHECK (qty > 0),
  CONSTRAINT wh_transfer_lines_one_per_item UNIQUE (transfer_id, item_id)
);

CREATE INDEX IF NOT EXISTS wh_transfer_lines_transfer_idx ON wh_transfer_lines (transfer_id);
CREATE INDEX IF NOT EXISTS wh_transfers_created_idx ON wh_transfers (created_at DESC);

ALTER TABLE wh_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wh_transfer_lines ENABLE ROW LEVEL SECURITY;

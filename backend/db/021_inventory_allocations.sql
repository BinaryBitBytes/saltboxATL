-- Location holds created from the Allocation tab.
-- A pick hold keeps received on-hand stock in place.
-- A slot hold keeps a putaway location reserved until that line is posted.

CREATE TABLE IF NOT EXISTS inventory_allocations (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale',
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  sku TEXT NOT NULL,
  batch TEXT,
  quantity INTEGER NOT NULL,
  location_id UUID NOT NULL,
  receiving_order_id UUID,
  case_id UUID,
  inventory_item_id UUID,
  picks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  released_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT inventory_allocations_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT inventory_allocations_kind_check CHECK (kind IN ('pick', 'slot')),
  CONSTRAINT inventory_allocations_status_check CHECK (status IN ('open', 'released', 'completed'))
);

CREATE INDEX IF NOT EXISTS inventory_allocations_location_idx
  ON inventory_allocations (location_id, status);

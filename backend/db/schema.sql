-- Saltbox warehouse inventory in PostgreSQL.
-- Nested receiving/shipping pallet contents stay in JSONB; photo bytes stay on disk.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  room_id UUID NOT NULL REFERENCES rooms (id),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'associate', 'manager')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY,
  sku TEXT NOT NULL,
  upc TEXT,
  batch TEXT,
  location_id UUID NOT NULL REFERENCES locations (id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  description TEXT,
  last_moved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  sku TEXT NOT NULL,
  upc TEXT,
  batch TEXT,
  inventory_item_id UUID,
  location_id UUID,
  destination_location_id UUID,
  quantity_delta INTEGER NOT NULL,
  quantity_before INTEGER,
  quantity_after INTEGER,
  reason TEXT,
  reference_type TEXT,
  reference_id UUID,
  scanned_code TEXT,
  created_by TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id UUID NOT NULL,
  document_kind TEXT NOT NULL DEFAULT 'freight-proof',
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY,
  purchase_order_number TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS receiving_orders (
  id UUID PRIMARY KEY,
  po_number TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  vendor TEXT NOT NULL,
  order_number TEXT NOT NULL,
  carrier_inbound TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  load_pallet_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  is_partialed BOOLEAN NOT NULL DEFAULT FALSE,
  partialed_at TIMESTAMPTZ,
  partialed_by TEXT,
  reopened_at TIMESTAMPTZ,
  reopened_by TEXT,
  working_pallet_id UUID,
  pallets JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS shipping_orders (
  id UUID PRIMARY KEY,
  shipped_at TIMESTAMPTZ NOT NULL,
  customer TEXT NOT NULL,
  shipment_number TEXT NOT NULL,
  carrier_outbound TEXT NOT NULL,
  shipper_name TEXT NOT NULL,
  load_pallet_count INTEGER NOT NULL DEFAULT 0,
  waiting_on_items BOOLEAN NOT NULL DEFAULT FALSE,
  items_in_jeopardy JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  pallets JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS inventory_items_sku_idx ON inventory_items (sku);
CREATE INDEX IF NOT EXISTS inventory_items_location_idx ON inventory_items (location_id);
CREATE INDEX IF NOT EXISTS inventory_transactions_occurred_idx ON inventory_transactions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS photos_owner_idx ON photos (owner_type, owner_id);

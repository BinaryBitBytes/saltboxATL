-- Unique 8-digit license plates for on-hand lines, plus the allocator
-- cursor and a registry so a plate cannot be stored twice.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS license_plate_number TEXT;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_lp_number_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_lp_number_check
  CHECK (license_plate_number IS NULL OR license_plate_number ~ '^[0-9]{8}$');

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_lp_number_key
  ON inventory_items (license_plate_number)
  WHERE license_plate_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS license_plate_ledger (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_ordinal >= 0 AND next_ordinal <= 100000000),
  active_users JSONB NOT NULL DEFAULT '[]'::jsonb,
  reservations JSONB NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO license_plate_ledger (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS license_plate_registry (
  number TEXT PRIMARY KEY CHECK (number ~ '^[0-9]{8}$'),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('inventory', 'check-in', 'check-out', 'hierarchy')),
  owner_id TEXT NOT NULL
);

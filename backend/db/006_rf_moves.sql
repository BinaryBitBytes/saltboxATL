ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS project_id TEXT;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'locations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%storage_class%'
  LOOP
    EXECUTE format('ALTER TABLE locations DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE locations
  ADD CONSTRAINT locations_storage_class_check
  CHECK (storage_class IN ('pallet', 'rack', 'staging', 'hold', 'container'));

CREATE TABLE IF NOT EXISTS site_transfers (
  id UUID PRIMARY KEY,
  transfer_number TEXT NOT NULL,
  trailer_location_id UUID NOT NULL REFERENCES locations (id),
  from_room_id UUID NOT NULL REFERENCES rooms (id),
  to_room_id UUID NOT NULL REFERENCES rooms (id),
  status TEXT NOT NULL CHECK (status IN ('loading', 'in-transit', 'arrived', 'unloaded', 'cancelled')),
  pallets JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS site_transfers_status_idx ON site_transfers (status);

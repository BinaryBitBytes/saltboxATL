-- Heal site tables that already existed when 014 ran.
-- CREATE TABLE IF NOT EXISTS does not add columns, so a site_transfers
-- table without ordered_at makes `ORDER BY ordered_at` fail (42703).

CREATE TABLE IF NOT EXISTS site_transfers (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale',
  status TEXT NOT NULL DEFAULT 'ordered',
  sku TEXT NOT NULL DEFAULT '',
  batch TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  source_site_id UUID,
  source_location_id UUID,
  destination_site_id UUID,
  destination_location_id UUID,
  ordered_by TEXT NOT NULL DEFAULT 'system',
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS batch TEXT;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS quantity INTEGER;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS source_site_id UUID;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS source_location_id UUID;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS destination_site_id UUID;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS destination_location_id UUID;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS ordered_by TEXT;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ;
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE site_transfers
SET ordered_at = now()
WHERE ordered_at IS NULL;

UPDATE site_transfers
SET ordered_by = 'system'
WHERE ordered_by IS NULL OR ordered_by = '';

UPDATE site_transfers
SET division = 'hyperscale'
WHERE division IS NULL OR division = '';

UPDATE site_transfers
SET status = 'ordered'
WHERE status IS NULL OR status = '';

UPDATE site_transfers
SET quantity = 1
WHERE quantity IS NULL OR quantity < 1;

UPDATE site_transfers
SET sku = 'UNKNOWN'
WHERE sku IS NULL OR sku = '';

ALTER TABLE site_transfers ALTER COLUMN ordered_at SET NOT NULL;
ALTER TABLE site_transfers ALTER COLUMN ordered_by SET NOT NULL;
ALTER TABLE site_transfers ALTER COLUMN division SET NOT NULL;
ALTER TABLE site_transfers ALTER COLUMN status SET NOT NULL;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS database_name TEXT;

UPDATE sites
SET database_name = 'saltbox_' || division || '_' || lower(codename)
WHERE database_name IS NULL OR database_name = '';

ALTER TABLE locations ADD COLUMN IF NOT EXISTS site_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS site_id UUID;

CREATE TABLE IF NOT EXISTS site_databases (
  database_name TEXT PRIMARY KEY,
  site_id UUID NOT NULL,
  division TEXT NOT NULL,
  payload JSONB NOT NULL
);

ALTER TABLE site_databases ADD COLUMN IF NOT EXISTS database_name TEXT;
ALTER TABLE site_databases ADD COLUMN IF NOT EXISTS site_id UUID;
ALTER TABLE site_databases ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE site_databases ADD COLUMN IF NOT EXISTS payload JSONB;

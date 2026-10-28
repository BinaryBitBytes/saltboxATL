-- Each work site keeps its inventory in its own database.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS database_name TEXT;

UPDATE sites
SET database_name = 'saltbox_' || division || '_' || lower(codename)
WHERE database_name IS NULL OR database_name = '';

ALTER TABLE sites ALTER COLUMN database_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sites_database_name_key ON sites (database_name);

ALTER TABLE locations ADD COLUMN IF NOT EXISTS site_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_site_id_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS site_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_site_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS site_databases (
  database_name TEXT PRIMARY KEY,
  site_id UUID NOT NULL UNIQUE REFERENCES sites (id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  payload JSONB NOT NULL,
  CONSTRAINT site_databases_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT site_databases_name_check CHECK (database_name ~ '^saltbox_[a-z0-9_]+$')
);

CREATE TABLE IF NOT EXISTS site_transfers (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL,
  status TEXT NOT NULL,
  sku TEXT NOT NULL,
  batch TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_site_id UUID NOT NULL REFERENCES sites (id),
  source_location_id UUID NOT NULL,
  destination_site_id UUID NOT NULL REFERENCES sites (id),
  destination_location_id UUID NOT NULL,
  ordered_by TEXT NOT NULL,
  ordered_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  CONSTRAINT site_transfers_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT site_transfers_status_check CHECK (status IN ('ordered', 'completed', 'cancelled'))
);

-- A site_transfers table created before this column existed is left unchanged
-- by CREATE TABLE IF NOT EXISTS. Add the column the loader sorts on.
ALTER TABLE site_transfers ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ;
UPDATE site_transfers SET ordered_at = now() WHERE ordered_at IS NULL;
ALTER TABLE site_transfers ALTER COLUMN ordered_at SET NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'user',
    'associate',
    'manager',
    'coordinator',
    'threepl',
    'project-manager',
    'product-developer',
    'logistics-coordinator',
    'it-admin',
    'superintendent',
    'driver',
    'security-associate',
    'security-manager'
  ));

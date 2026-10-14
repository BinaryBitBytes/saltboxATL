-- Division_1 Hyperscale and Division_2 Security store inventory separately.

CREATE TABLE IF NOT EXISTS divisions (
  id TEXT PRIMARY KEY CHECK (id IN ('hyperscale', 'security')),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

INSERT INTO divisions (id, code, name) VALUES
  ('hyperscale', 'Division_1', 'Hyperscale'),
  ('security', 'Division_2', 'Security')
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name;

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
    'driver',
    'security-associate',
    'security-manager'
  ));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'rooms',
    'locations',
    'users',
    'inventory_items',
    'inventory_transactions',
    'photos',
    'purchase_orders',
    'receiving_orders',
    'shipping_orders',
    'customer_orders',
    'item_cubes'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT %L',
      table_name,
      'hyperscale'
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = table_name || '_division_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (division IN (%L, %L))',
        table_name,
        table_name || '_division_check',
        'hyperscale',
        'security'
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = table_name || '_division_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (division) REFERENCES divisions (id)',
        table_name,
        table_name || '_division_fkey'
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_code_key'
  ) THEN
    ALTER TABLE locations DROP CONSTRAINT locations_code_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_division_code_key'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_division_code_key UNIQUE (division, code);
  END IF;
END $$;

DO $$
DECLARE
  pk_width int;
BEGIN
  SELECT array_length(c.conkey, 1)
  INTO pk_width
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'item_cubes'
    AND c.contype = 'p';

  IF pk_width = 1 THEN
    ALTER TABLE item_cubes DROP CONSTRAINT item_cubes_pkey;
    ALTER TABLE item_cubes ADD PRIMARY KEY (division, sku);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_items_division_idx
  ON inventory_items (division, sku);
CREATE INDEX IF NOT EXISTS locations_division_idx
  ON locations (division, code);

CREATE OR REPLACE VIEW hyperscale_inventory_items AS
  SELECT * FROM inventory_items WHERE division = 'hyperscale';

CREATE OR REPLACE VIEW security_inventory_items AS
  SELECT * FROM inventory_items WHERE division = 'security';

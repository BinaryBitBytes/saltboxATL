ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'user',
    'associate',
    'manager',
    'coordinator',
    'threepl',
    'project-manager',
    'driver'
  ));

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS carrier TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_arrival_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS buyer_name TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expectation_notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expectation_status TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_pallet_count INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS lines JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_expectation_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_expectation_status_check
  CHECK (
    expectation_status IS NULL
    OR expectation_status IN ('expected', 'in-transit', 'cancelled')
  );

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_source_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_source_check
  CHECK (source IS NULL OR source IN ('coordinator', 'receipt'));

ALTER TABLE shipping_orders ADD COLUMN IF NOT EXISTS delivery JSONB;

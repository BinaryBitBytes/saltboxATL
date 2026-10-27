ALTER TABLE receiving_orders
  ADD COLUMN IF NOT EXISTS backorder_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS customer_orders (
  id UUID PRIMARY KEY,
  order_number TEXT NOT NULL,
  customer TEXT NOT NULL,
  placed_by TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('picking', 'fulfilled', 'cancelled')),
  submitted_at TIMESTAMPTZ NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  print_batch JSONB NOT NULL,
  pick_request JSONB NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS customer_orders_submitted_idx ON customer_orders (submitted_at DESC);
CREATE INDEX IF NOT EXISTS customer_orders_status_idx ON customer_orders (status);

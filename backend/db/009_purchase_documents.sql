ALTER TABLE receiving_orders ADD COLUMN IF NOT EXISTS intake TEXT;
ALTER TABLE receiving_orders DROP CONSTRAINT IF EXISTS receiving_orders_intake_check;
ALTER TABLE receiving_orders ADD CONSTRAINT receiving_orders_intake_check
  CHECK (intake IS NULL OR intake IN ('dock', 'expected'));

CREATE TABLE IF NOT EXISTS purchase_documents (
  id UUID PRIMARY KEY,
  purchase_order_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('purchase-order', 'invoice')),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  prices_redacted BOOLEAN NOT NULL DEFAULT FALSE,
  recognition_source TEXT NOT NULL CHECK (recognition_source IN ('composio', 'embedded-text')),
  recognition_note TEXT,
  job_id_number TEXT,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  inbound_load_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  CONSTRAINT purchase_documents_division_check CHECK (division IN ('hyperscale', 'security'))
);

CREATE INDEX IF NOT EXISTS purchase_documents_po_idx ON purchase_documents (purchase_order_number);

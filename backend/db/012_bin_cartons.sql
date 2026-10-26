-- Cartons in a bin keep their own license plates, plus the PO and job
-- that decide whether separate items may share that slot.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS po_number TEXT,
  ADD COLUMN IF NOT EXISTS job_id_number TEXT,
  ADD COLUMN IF NOT EXISTS cartons JSONB NOT NULL DEFAULT '[]'::jsonb;

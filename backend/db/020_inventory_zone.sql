-- Inventory lines can be categorized into a warehouse zone from the Zoning tab.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES zones (id);

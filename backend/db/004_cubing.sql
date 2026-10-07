ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS storage_class TEXT,
  ADD COLUMN IF NOT EXISTS cube_capacity_cubic_inches DOUBLE PRECISION;

UPDATE locations
SET storage_class = CASE
  WHEN code ILIKE 'DOCK%' OR code ILIKE '%STAGE%' THEN 'staging'
  WHEN code ILIKE 'DMG%' OR code ILIKE '%HOLD%' THEN 'hold'
  WHEN code ILIKE 'PLT%' OR code ILIKE '%PALLET%' THEN 'pallet'
  ELSE 'rack'
END
WHERE storage_class IS NULL;

UPDATE locations
SET cube_capacity_cubic_inches = CASE storage_class
  WHEN 'pallet' THEN 138240
  WHEN 'staging' THEN 184320
  WHEN 'hold' THEN 138240
  ELSE 18144
END
WHERE cube_capacity_cubic_inches IS NULL;

ALTER TABLE locations
  ALTER COLUMN storage_class SET DEFAULT 'rack';
ALTER TABLE locations
  ALTER COLUMN storage_class SET NOT NULL;
ALTER TABLE locations
  ALTER COLUMN cube_capacity_cubic_inches SET DEFAULT 18144;
ALTER TABLE locations
  ALTER COLUMN cube_capacity_cubic_inches SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'locations_storage_class_check'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_storage_class_check
      CHECK (storage_class IN ('pallet', 'rack', 'staging', 'hold'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS item_cubes (
  sku TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  length_inches DOUBLE PRECISION NOT NULL,
  width_inches DOUBLE PRECISION NOT NULL,
  height_inches DOUBLE PRECISION NOT NULL,
  cubic_inches DOUBLE PRECISION NOT NULL,
  units_per_case INTEGER NOT NULL DEFAULT 1,
  cubed_at TIMESTAMPTZ NOT NULL,
  cubed_by TEXT
);

INSERT INTO locations (
  id, code, room_id, description, is_active, storage_class, cube_capacity_cubic_inches
)
SELECT
  'aaaa6666-6666-4666-8666-666666666666',
  'PLT-01',
  rooms.id,
  'Full pallet location 1',
  TRUE,
  'pallet',
  138240
FROM rooms
WHERE rooms.id = '33333333-3333-4333-8333-333333333333'
  AND NOT EXISTS (SELECT 1 FROM locations WHERE code = 'PLT-01');

INSERT INTO locations (
  id, code, room_id, description, is_active, storage_class, cube_capacity_cubic_inches
)
SELECT
  'aaaa7777-7777-4777-8777-777777777777',
  'PLT-02',
  rooms.id,
  'Full pallet location 2',
  TRUE,
  'pallet',
  138240
FROM rooms
WHERE rooms.id = '33333333-3333-4333-8333-333333333333'
  AND NOT EXISTS (SELECT 1 FROM locations WHERE code = 'PLT-02');

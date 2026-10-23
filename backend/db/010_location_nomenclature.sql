-- Division-scoped logistics address:
-- codename, building, zone, aisle, bay, slot, plus trailer / license plate / container.

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  codename TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT sites_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT sites_codename_check CHECK (codename IN (
    'ALPHA', 'BETA', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
    'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA',
    'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY',
    'XRAY', 'YANKEE', 'ZULU'
  )),
  CONSTRAINT sites_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT sites_division_codename_key UNIQUE (division, codename)
);

CREATE TABLE IF NOT EXISTS buildings (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  site_id UUID NOT NULL REFERENCES sites (id),
  number INTEGER NOT NULL,
  room_id UUID NOT NULL REFERENCES rooms (id),
  CONSTRAINT buildings_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT buildings_number_check CHECK (number BETWEEN 1 AND 100),
  CONSTRAINT buildings_site_number_key UNIQUE (site_id, number)
);

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  building_id UUID NOT NULL REFERENCES buildings (id),
  letter TEXT NOT NULL,
  item_type TEXT NOT NULL,
  cube_size TEXT NOT NULL,
  project_id TEXT,
  po_number TEXT,
  inbound_velocity TEXT NOT NULL,
  outbound_velocity TEXT NOT NULL,
  CONSTRAINT zones_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT zones_letter_check CHECK (letter ~ '^[A-Z]$'),
  CONSTRAINT zones_cube_size_check CHECK (cube_size IN ('small', 'medium', 'large', 'pallet')),
  CONSTRAINT zones_inbound_velocity_check CHECK (inbound_velocity IN ('fast', 'medium', 'slow')),
  CONSTRAINT zones_outbound_velocity_check CHECK (outbound_velocity IN ('fast', 'medium', 'slow')),
  CONSTRAINT zones_building_letter_key UNIQUE (building_id, letter)
);

CREATE TABLE IF NOT EXISTS aisles (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  zone_id UUID NOT NULL REFERENCES zones (id),
  number INTEGER NOT NULL,
  CONSTRAINT aisles_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT aisles_number_check CHECK (number BETWEEN 1 AND 99),
  CONSTRAINT aisles_zone_number_key UNIQUE (zone_id, number)
);

CREATE TABLE IF NOT EXISTS bays (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  aisle_id UUID NOT NULL REFERENCES aisles (id),
  number INTEGER NOT NULL,
  cube_budget_cubic_inches DOUBLE PRECISION NOT NULL,
  CONSTRAINT bays_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT bays_number_check CHECK (number BETWEEN 1 AND 99),
  CONSTRAINT bays_budget_check CHECK (cube_budget_cubic_inches > 0),
  CONSTRAINT bays_aisle_number_key UNIQUE (aisle_id, number)
);

CREATE TABLE IF NOT EXISTS trailers (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  site_id UUID NOT NULL REFERENCES sites (id),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'arrived',
  CONSTRAINT trailers_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT trailers_code_check CHECK (code ~ '^TN[0-9]{6}$' AND code <> 'TN000000'),
  CONSTRAINT trailers_status_check CHECK (status IN ('expected', 'arrived', 'departed')),
  CONSTRAINT trailers_division_code_key UNIQUE (division, code)
);

CREATE TABLE IF NOT EXISTS license_plates (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  code TEXT NOT NULL,
  location_id UUID REFERENCES locations (id),
  trailer_id UUID REFERENCES trailers (id),
  CONSTRAINT license_plates_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT license_plates_code_check CHECK (code ~ '^LP[A-Z0-9]{8}$'),
  CONSTRAINT license_plates_place_check CHECK (
    (location_id IS NOT NULL AND trailer_id IS NULL)
    OR (location_id IS NULL AND trailer_id IS NOT NULL)
  ),
  CONSTRAINT license_plates_division_code_key UNIQUE (division, code)
);

CREATE TABLE IF NOT EXISTS containers (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL DEFAULT 'hyperscale' REFERENCES divisions (id),
  license_plate_id UUID NOT NULL REFERENCES license_plates (id),
  code TEXT NOT NULL,
  CONSTRAINT containers_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT containers_code_check CHECK (code ~ '^CN[A-Z0-9]{8}$'),
  CONSTRAINT containers_division_code_key UNIQUE (division, code)
);

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS bay_id UUID REFERENCES bays (id),
  ADD COLUMN IF NOT EXISTS slot_kind TEXT,
  ADD COLUMN IF NOT EXISTS height TEXT,
  ADD COLUMN IF NOT EXISTS position INTEGER,
  ADD COLUMN IF NOT EXISTS side TEXT;

ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_slot_shape_check;
ALTER TABLE locations ADD CONSTRAINT locations_slot_shape_check CHECK (
  slot_kind IS NULL
  OR (
    slot_kind = 'pick'
    AND height IN ('A', 'B', 'C', 'D')
    AND position BETWEEN 1 AND 9
    AND side IS NULL
  )
  OR (
    slot_kind = 'overhead'
    AND height IN ('04', '05', '06', '07', '08', '09')
    AND position IS NULL
    AND side IN ('A', 'B')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS locations_bay_slot_key
  ON locations (
    bay_id,
    slot_kind,
    height,
    COALESCE(position, -1),
    COALESCE(side, '')
  )
  WHERE bay_id IS NOT NULL;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS license_plate_id UUID REFERENCES license_plates (id),
  ADD COLUMN IF NOT EXISTS container_id UUID REFERENCES containers (id);

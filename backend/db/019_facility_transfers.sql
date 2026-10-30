-- Trailer loads between facilities. Line quantities, routes, and license plates
-- travel in `lines` so a receipt can be checked against what was loaded.

CREATE TABLE IF NOT EXISTS facility_transfers (
  id UUID PRIMARY KEY,
  division TEXT NOT NULL,
  status TEXT NOT NULL,
  trailer_code TEXT NOT NULL,
  source_site_id UUID NOT NULL,
  destination_site_id UUID NOT NULL,
  source_nomenclature TEXT NOT NULL,
  destination_nomenclature TEXT NOT NULL,
  loaded_by TEXT NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL,
  received_by TEXT,
  received_at TIMESTAMPTZ,
  notes TEXT,
  lines JSONB NOT NULL,
  CONSTRAINT facility_transfers_division_check CHECK (division IN ('hyperscale', 'security')),
  CONSTRAINT facility_transfers_status_check CHECK (status IN ('in-transit', 'partial', 'received'))
);

CREATE INDEX IF NOT EXISTS facility_transfers_route_idx
  ON facility_transfers (source_site_id, destination_site_id, loaded_at);

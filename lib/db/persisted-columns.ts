import type {
  FacilityTransfer,
  Location,
  Site,
  SiteTransfer,
  User,
} from "@/lib/inventory-schema";

/**
 * SQL columns for one persisted app type.
 * `satisfies Record<keyof T, string>` fails the build when a type field has no column.
 */
export const SITE_TRANSFER_COLUMNS = {
  id: "id",
  division: "division",
  status: "status",
  sku: "sku",
  batch: "batch",
  quantity: "quantity",
  sourceSiteId: "source_site_id",
  sourceLocationId: "source_location_id",
  destinationSiteId: "destination_site_id",
  destinationLocationId: "destination_location_id",
  orderedBy: "ordered_by",
  orderedAt: "ordered_at",
  notes: "notes",
} as const satisfies Record<keyof SiteTransfer, string>;

export const SITE_COLUMNS = {
  id: "id",
  division: "division",
  codename: "codename",
  state: "state",
  city: "city",
  name: "name",
  databaseName: "database_name",
} as const satisfies Record<keyof Site, string>;

export const USER_SITE_COLUMN = {
  siteId: "site_id",
  allowedSiteIds: "allowed_site_ids",
  allowedDivisions: "allowed_divisions",
} as const satisfies Record<
  Extract<keyof User, "siteId" | "allowedSiteIds" | "allowedDivisions">,
  string
>;

export const LOCATION_SITE_COLUMN = {
  siteId: "site_id",
} as const satisfies Record<Extract<keyof Location, "siteId">, string>;

/** Registry row that points at one site's inventory database. */
export const SITE_DATABASE_COLUMNS = [
  "database_name",
  "site_id",
  "division",
  "payload",
] as const;

export const SITE_TRANSFER_SQL_COLUMNS = Object.values(SITE_TRANSFER_COLUMNS);

export const FACILITY_TRANSFER_COLUMNS = {
  id: "id",
  division: "division",
  status: "status",
  trailerCode: "trailer_code",
  sourceSiteId: "source_site_id",
  destinationSiteId: "destination_site_id",
  sourceNomenclature: "source_nomenclature",
  destinationNomenclature: "destination_nomenclature",
  loadedBy: "loaded_by",
  loadedAt: "loaded_at",
  receivedBy: "received_by",
  receivedAt: "received_at",
  notes: "notes",
  lines: "lines",
} as const satisfies Record<keyof FacilityTransfer, string>;

export const FACILITY_TRANSFER_SQL_COLUMNS = Object.values(FACILITY_TRANSFER_COLUMNS);

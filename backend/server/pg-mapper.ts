import {
  BackorderLineSchema,
  BuyerPoLineSchema,
  DeliveryRecordSchema,
  ExpectationStatusSchema,
  PalletSchema,
  PurchaseOrderSourceSchema,
  PurchaseDocumentKindSchema,
  PurchaseDocumentLineSchema,
  RecognitionSourceSchema,
  CustomerOrderSchema,
  type CustomerOrder,
  type InventoryItem,
  type InventorySystem,
  type InventoryTransaction,
  type Aisle,
  type Bay,
  type Building,
  type Container,
  type ItemCube,
  type LicensePlate,
  type LicensePlateLedger,
  LicensePlateLedgerSchema,
  type Location,
  type Pallet,
  type PhotoAttachment,
  type PurchaseDocument,
  type PurchaseOrder,
  type ReceivingOrder,
  type Room,
  type ShippingOrder,
  type Site,
  FacilityTransferLineSchema,
  type FacilityTransfer,
  type SiteTransfer,
  type Trailer,
  type User,
  type Zone,
} from "@/lib/inventory-schema";
import {
  defaultCubeCapacity,
  defaultStorageClass,
  type StorageClass,
} from "@/lib/cubing/measure";
import { asDivision } from "@/lib/divisions";
import type { Division } from "@/lib/inventory-schema";

function storedDivision(value: string | null | undefined): Division {
  return asDivision(value);
}

function parseBackorderLines(raw: unknown): ReceivingOrder["backorderLines"] {
  const parsed = BackorderLineSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

export function parseStoredPallets(raw: unknown): Pallet[] {
  const parsed = PalletSchema.array().safeParse(raw ?? []);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const cases = Array.isArray(row.cases)
      ? row.cases.map((item) => {
          if (!item || typeof item !== "object") return item;
          const caseRow = item as Record<string, unknown>;
          return {
            ...caseRow,
            manufacturer: caseRow.manufacturer ?? "",
            color: caseRow.color === undefined ? null : caseRow.color,
          };
        })
      : [];
    const one = PalletSchema.safeParse({
      ...row,
      trackingNumber: row.trackingNumber ?? "",
      cases,
    });
    return one.success ? [one.data] : [];
  });
}

export function iso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function isoRequired(value: Date | string | null | undefined): string {
  const converted = iso(value);
  if (!converted) {
    throw new Error("Expected a timestamp.");
  }
  return converted;
}

export function mapRoom(row: {
  id: string;
  name: string;
  description: string | null;
  division?: string | null;
}): Room {
  return {
    id: row.id,
    division: storedDivision(row.division),
    name: row.name,
    description: row.description ?? undefined,
  };
}

function storageClassFrom(
  value: string | null | undefined,
  code: string,
): StorageClass {
  if (
    value === "pallet" ||
    value === "rack" ||
    value === "staging" ||
    value === "hold"
  ) {
    return value;
  }
  return defaultStorageClass(code);
}

export function mapLocation(row: {
  id: string;
  code: string;
  room_id: string;
  description: string | null;
  is_active: boolean;
  storage_class?: string | null;
  cube_capacity_cubic_inches?: number | string | null;
  division?: string | null;
  site_id?: string | null;
  bay_id?: string | null;
  slot_kind?: string | null;
  height?: string | null;
  position?: number | string | null;
  side?: string | null;
}): Location {
  const storageClass = storageClassFrom(row.storage_class, row.code);
  const capacity = Number(row.cube_capacity_cubic_inches);
  const position = row.position == null || row.position === "" ? null : Number(row.position);
  const slotKind = row.slot_kind === "pick" || row.slot_kind === "overhead" ? row.slot_kind : null;
  const side = row.side === "A" || row.side === "B" ? row.side : null;
  return {
    id: row.id,
    division: storedDivision(row.division),
    siteId: row.site_id || undefined,
    code: row.code,
    roomId: row.room_id,
    description: row.description ?? undefined,
    isActive: row.is_active,
    storageClass,
    cubeCapacityCubicInches:
      Number.isFinite(capacity) && capacity > 0
        ? capacity
        : defaultCubeCapacity(storageClass),
    bayId: row.bay_id ?? null,
    slotKind,
    height: row.height ?? null,
    position: position != null && Number.isFinite(position) ? position : null,
    side,
  };
}

export function mapSite(row: {
  id: string;
  division?: string | null;
  codename: Site["codename"];
  state: string;
  city: string;
  name: string;
  database_name?: string | null;
}): Site {
  return {
    id: row.id,
    division: storedDivision(row.division),
    codename: row.codename,
    state: row.state.trim().toUpperCase(),
    city: row.city,
    name: row.name,
    databaseName: row.database_name || undefined,
  };
}

export function mapBuilding(row: {
  id: string;
  division?: string | null;
  site_id: string;
  number: number | string;
  room_id: string;
}): Building {
  return {
    id: row.id,
    division: storedDivision(row.division),
    siteId: row.site_id,
    number: Number(row.number),
    roomId: row.room_id,
  };
}

export function mapZone(row: {
  id: string;
  division?: string | null;
  building_id: string;
  letter: string;
  item_type: string;
  cube_size: Zone["cubeSize"];
  project_id: string | null;
  po_number: string | null;
  inbound_velocity: Zone["inboundVelocity"];
  outbound_velocity: Zone["outboundVelocity"];
}): Zone {
  return {
    id: row.id,
    division: storedDivision(row.division),
    buildingId: row.building_id,
    letter: row.letter,
    itemType: row.item_type,
    cubeSize: row.cube_size,
    projectId: row.project_id,
    poNumber: row.po_number,
    inboundVelocity: row.inbound_velocity,
    outboundVelocity: row.outbound_velocity,
  };
}

export function mapAisle(row: {
  id: string;
  division?: string | null;
  zone_id: string;
  number: number | string;
}): Aisle {
  return {
    id: row.id,
    division: storedDivision(row.division),
    zoneId: row.zone_id,
    number: Number(row.number),
  };
}

export function mapBay(row: {
  id: string;
  division?: string | null;
  aisle_id: string;
  number: number | string;
  cube_budget_cubic_inches: number | string;
}): Bay {
  return {
    id: row.id,
    division: storedDivision(row.division),
    aisleId: row.aisle_id,
    number: Number(row.number),
    cubeBudgetCubicInches: Number(row.cube_budget_cubic_inches),
  };
}

export function mapTrailer(row: {
  id: string;
  division?: string | null;
  site_id: string;
  code: string;
  status: Trailer["status"];
}): Trailer {
  return {
    id: row.id,
    division: storedDivision(row.division),
    siteId: row.site_id,
    code: row.code,
    status: row.status,
  };
}

export function mapLicensePlate(row: {
  id: string;
  division?: string | null;
  code: string;
  location_id: string | null;
  trailer_id: string | null;
}): LicensePlate {
  return {
    id: row.id,
    division: storedDivision(row.division),
    code: row.code,
    locationId: row.location_id,
    trailerId: row.trailer_id,
  };
}

function storedCartons(value: unknown): InventoryItem["cartons"] {
  const parsed = storedJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const cartons = parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { licensePlateNumber?: unknown; quantity?: unknown };
    if (typeof row.licensePlateNumber !== "string" || !/^\d{8}$/.test(row.licensePlateNumber)) {
      return [];
    }
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return [];
    return [{ licensePlateNumber: row.licensePlateNumber, quantity }];
  });
  return cartons.length > 0 ? cartons : undefined;
}

function storedDivisionList(
  value: unknown,
): Array<"hyperscale" | "security"> | undefined {
  const parsed = storedJson(value);
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter(
    (entry): entry is "hyperscale" | "security" =>
      entry === "hyperscale" || entry === "security",
  );
}

function storedUuidList(value: unknown): string[] | undefined {
  const parsed = storedJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const ids = parsed.filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        entry,
      ),
  );
  return ids;
}

function storedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function mapLicensePlateLedger(row: {
  next_ordinal: number | string;
  active_users: unknown;
  reservations: unknown;
} | null | undefined): LicensePlateLedger | undefined {
  if (!row) return undefined;
  const parsed = LicensePlateLedgerSchema.safeParse({
    nextOrdinal: Number(row.next_ordinal),
    activeUsers: storedJson(row.active_users) ?? [],
    reservations: storedJson(row.reservations) ?? [],
  });
  return parsed.success ? parsed.data : undefined;
}

export function mapContainer(row: {
  id: string;
  division?: string | null;
  license_plate_id: string;
  code: string;
}): Container {
  return {
    id: row.id,
    division: storedDivision(row.division),
    licensePlateId: row.license_plate_id,
    code: row.code,
  };
}

export function mapItemCube(row: {
  sku: string;
  description: string | null;
  length_inches: number | string;
  width_inches: number | string;
  height_inches: number | string;
  cubic_inches: number | string;
  units_per_case: number | string;
  cubed_at: Date | string;
  cubed_by: string | null;
  division?: string | null;
}): ItemCube {
  return {
    sku: row.sku,
    division: storedDivision(row.division),
    description: row.description ?? "",
    lengthInches: Number(row.length_inches),
    widthInches: Number(row.width_inches),
    heightInches: Number(row.height_inches),
    cubicInches: Number(row.cubic_inches),
    unitsPerCase: Number(row.units_per_case) || 1,
    cubedAt: isoRequired(row.cubed_at),
    cubedBy: row.cubed_by ?? undefined,
  };
}

export function mapUser(row: {
  id: string;
  name: string;
  username: string;
  email: string;
  password_hash: string;
  role: User["role"];
  is_active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
  division?: string | null;
  site_id?: string | null;
  allowed_site_ids?: unknown;
  allowed_divisions?: unknown;
}): User {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    division: storedDivision(row.division),
    siteId: row.site_id || undefined,
    allowedSiteIds: storedUuidList(row.allowed_site_ids),
    allowedDivisions: storedDivisionList(row.allowed_divisions),
    isActive: row.is_active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function mapSiteTransfer(row: {
  id: string;
  division?: string | null;
  status: SiteTransfer["status"];
  sku: string;
  batch: string | null;
  quantity: number | string;
  source_site_id: string;
  source_location_id: string;
  destination_site_id: string;
  destination_location_id: string;
  ordered_by: string;
  ordered_at: Date | string;
  notes: string | null;
}): SiteTransfer {
  return {
    id: row.id,
    division: storedDivision(row.division),
    status: row.status,
    sku: row.sku,
    batch: row.batch,
    quantity: Number(row.quantity),
    sourceSiteId: row.source_site_id,
    sourceLocationId: row.source_location_id,
    destinationSiteId: row.destination_site_id,
    destinationLocationId: row.destination_location_id,
    orderedBy: row.ordered_by,
    orderedAt: isoRequired(row.ordered_at),
    notes: row.notes ?? undefined,
  };
}

export function mapFacilityTransfer(row: {
  id: string;
  division?: string | null;
  status: FacilityTransfer["status"];
  trailer_code: string;
  source_site_id: string;
  destination_site_id: string;
  source_nomenclature: string;
  destination_nomenclature: string;
  loaded_by: string;
  loaded_at: Date | string;
  received_by: string | null;
  received_at: Date | string | null;
  notes: string | null;
  lines: unknown;
}): FacilityTransfer {
  return {
    id: row.id,
    division: storedDivision(row.division),
    status: row.status,
    trailerCode: row.trailer_code,
    sourceSiteId: row.source_site_id,
    destinationSiteId: row.destination_site_id,
    sourceNomenclature: row.source_nomenclature,
    destinationNomenclature: row.destination_nomenclature,
    loadedBy: row.loaded_by,
    loadedAt: isoRequired(row.loaded_at),
    receivedBy: row.received_by ?? undefined,
    receivedAt: iso(row.received_at),
    notes: row.notes ?? undefined,
    lines: FacilityTransferLineSchema.array().parse(storedJson(row.lines)),
  };
}

export function mapItem(row: {
  id: string;
  sku: string;
  upc: string | null;
  batch: string | null;
  location_id: string;
  quantity: number;
  description: string | null;
  manufacturer?: string | null;
  color?: string | null;
  is_fiber?: boolean | null;
  connection_type?: string | null;
  strand_count?: number | string | null;
  length_meters?: number | string | null;
  last_moved_at: Date | string | null;
  updated_at: Date | string | null;
  division?: string | null;
  license_plate_id?: string | null;
  license_plate_number?: string | null;
  po_number?: string | null;
  job_id_number?: string | null;
  cartons?: unknown;
  container_id?: string | null;
  cube_forced?: boolean | null;
}): InventoryItem {
  const strandCount =
    row.strand_count == null || row.strand_count === ""
      ? null
      : Number(row.strand_count);
  const lengthMeters =
    row.length_meters == null || row.length_meters === ""
      ? null
      : Number(row.length_meters);
  const hasFiber =
    Boolean(row.is_fiber) ||
    Boolean(row.connection_type) ||
    strandCount != null ||
    lengthMeters != null;
  return {
    id: row.id,
    division: storedDivision(row.division),
    sku: row.sku,
    upc: row.upc ?? undefined,
    batch: row.batch,
    locationId: row.location_id,
    licensePlateId: row.license_plate_id ?? null,
    licensePlateNumber: row.license_plate_number ?? null,
    poNumber: row.po_number ?? null,
    jobIdNumber: row.job_id_number ?? null,
    cartons: storedCartons(row.cartons),
    containerId: row.container_id ?? null,
    quantity: row.quantity,
    description: row.description ?? undefined,
    manufacturer: row.manufacturer ?? "",
    color: row.color ?? null,
    fiber: hasFiber
      ? {
          isFiber: Boolean(row.is_fiber),
          connectionType:
            row.connection_type === "LC" ||
            row.connection_type === "SC" ||
            row.connection_type === "ST" ||
            row.connection_type === "FC" ||
            row.connection_type === "MPO" ||
            row.connection_type === "MTP" ||
            row.connection_type === "Other"
              ? row.connection_type
              : null,
          strandCount: Number.isFinite(strandCount) ? strandCount : null,
          lengthMeters: Number.isFinite(lengthMeters) ? lengthMeters : null,
        }
      : null,
    lastMovedAt: iso(row.last_moved_at),
    updatedAt: iso(row.updated_at),
    cubeForced: row.cube_forced === true,
  };
}

export function mapTransaction(row: {
  id: string;
  type: InventoryTransaction["type"];
  occurred_at: Date | string;
  sku: string;
  upc: string | null;
  batch: string | null;
  inventory_item_id: string | null;
  location_id: string | null;
  destination_location_id: string | null;
  quantity_delta: number;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: string | null;
  reference_type: InventoryTransaction["referenceType"] | null;
  reference_id: string | null;
  scanned_code: string | null;
  created_by: string | null;
  notes: string | null;
  division?: string | null;
  cube_forced?: boolean | null;
}): InventoryTransaction {
  return {
    id: row.id,
    division: storedDivision(row.division),
    type: row.type,
    occurredAt: isoRequired(row.occurred_at),
    sku: row.sku,
    upc: row.upc ?? undefined,
    batch: row.batch,
    inventoryItemId: row.inventory_item_id,
    locationId: row.location_id,
    destinationLocationId: row.destination_location_id,
    quantityDelta: row.quantity_delta,
    quantityBefore: row.quantity_before ?? undefined,
    quantityAfter: row.quantity_after ?? undefined,
    reason: row.reason ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    scannedCode: row.scanned_code ?? undefined,
    createdBy: row.created_by ?? undefined,
    notes: row.notes ?? undefined,
    cubeForced: row.cube_forced === true,
  };
}

export function mapPhoto(row: {
  id: string;
  owner_type: PhotoAttachment["ownerType"];
  owner_id: string;
  document_kind: PhotoAttachment["documentKind"];
  original_name: string;
  mime_type: PhotoAttachment["mimeType"];
  size: number;
  caption: string | null;
  created_at: Date | string;
  created_by: string | null;
  division?: string | null;
}): PhotoAttachment {
  return {
    id: row.id,
    division: storedDivision(row.division),
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    documentKind: row.document_kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    caption: row.caption ?? undefined,
    createdAt: isoRequired(row.created_at),
    createdBy: row.created_by ?? undefined,
  };
}

function parseBuyerLines(raw: unknown): PurchaseOrder["lines"] {
  if (raw == null) return undefined;
  const parsed = BuyerPoLineSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function parseDelivery(raw: unknown): ShippingOrder["delivery"] {
  if (raw == null) return undefined;
  const parsed = DeliveryRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function mapPurchaseOrder(row: {
  id: string;
  purchase_order_number: string;
  generated_at: Date | string;
  created_at: Date | string | null;
  job_id_number?: string | null;
  project_id?: string | null;
  vendor?: string | null;
  carrier?: string | null;
  expected_arrival_at?: Date | string | null;
  buyer_name?: string | null;
  expectation_notes?: string | null;
  expectation_status?: string | null;
  expected_pallet_count?: number | null;
  lines?: unknown;
  uploaded_by?: string | null;
  source?: string | null;
  division?: string | null;
}): PurchaseOrder {
  const jobId = row.job_id_number?.trim();
  const projectId = row.project_id?.trim();
  const expectationStatus = ExpectationStatusSchema.safeParse(row.expectation_status);
  const source = PurchaseOrderSourceSchema.safeParse(row.source);
  return {
    id: row.id,
    division: storedDivision(row.division),
    purchaseOrderNumber: row.purchase_order_number,
    generatedAt: isoRequired(row.generated_at),
    createdAt: iso(row.created_at),
    jobIdNumber: jobId ? jobId : null,
    projectId: projectId ? projectId : null,
    vendor: row.vendor ?? null,
    carrier: row.carrier ?? null,
    expectedArrivalAt: iso(row.expected_arrival_at) ?? null,
    buyerName: row.buyer_name ?? null,
    expectationNotes: row.expectation_notes ?? undefined,
    expectationStatus: expectationStatus.success ? expectationStatus.data : null,
    expectedPalletCount: row.expected_pallet_count ?? null,
    lines: parseBuyerLines(row.lines),
    uploadedBy: row.uploaded_by ?? undefined,
    source: source.success ? source.data : undefined,
  };
}

export function mapReceivingOrder(row: {
  id: string;
  po_number: string;
  received_at: Date | string;
  vendor: string;
  order_number: string;
  carrier_inbound: string;
  receiver_name: string;
  load_pallet_count: number;
  status: ReceivingOrder["status"];
  is_partialed: boolean;
  partialed_at: Date | string | null;
  partialed_by: string | null;
  reopened_at: Date | string | null;
  reopened_by: string | null;
  working_pallet_id: string | null;
  pallets: unknown;
  notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
  intake?: string | null;
  division?: string | null;
  backorder_lines?: unknown;
}): ReceivingOrder {
  const intake = row.intake === "expected" || row.intake === "dock" ? row.intake : undefined;
  return {
    id: row.id,
    division: storedDivision(row.division),
    poNumber: row.po_number,
    receivedAt: isoRequired(row.received_at),
    vendor: row.vendor,
    orderNumber: row.order_number,
    carrierInbound: row.carrier_inbound,
    receiverName: row.receiver_name,
    loadPalletCount: row.load_pallet_count,
    status: row.status,
    intake,
    backorderLines: parseBackorderLines(row.backorder_lines),
    isPartialed: row.is_partialed,
    partialedAt: iso(row.partialed_at),
    partialedBy: row.partialed_by ?? undefined,
    reopenedAt: iso(row.reopened_at),
    reopenedBy: row.reopened_by ?? undefined,
    workingPalletId: row.working_pallet_id,
    pallets: parseStoredPallets(row.pallets),
    notes: row.notes ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

function parseDocumentLines(raw: unknown): PurchaseDocument["lines"] {
  const parsed = PurchaseDocumentLineSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

export function mapPurchaseDocument(row: {
  id: string;
  purchase_order_number: string;
  kind: string;
  original_name: string;
  mime_type: string;
  size: number;
  prices_redacted: boolean;
  recognition_source: string;
  recognition_note?: string | null;
  job_id_number?: string | null;
  lines?: unknown;
  inbound_load_id?: string | null;
  created_at: Date | string;
  created_by?: string | null;
  division?: string | null;
}): PurchaseDocument {
  const kind = PurchaseDocumentKindSchema.parse(row.kind);
  const recognitionSource = RecognitionSourceSchema.parse(row.recognition_source);
  const jobId = row.job_id_number?.trim();
  return {
    id: row.id,
    division: storedDivision(row.division),
    purchaseOrderNumber: row.purchase_order_number,
    kind,
    originalName: row.original_name,
    mimeType: "application/pdf",
    size: row.size,
    pricesRedacted: row.prices_redacted,
    recognitionSource,
    recognitionNote: row.recognition_note ?? undefined,
    jobIdNumber: jobId ? jobId : null,
    lines: parseDocumentLines(row.lines),
    inboundLoadId: row.inbound_load_id ?? null,
    createdAt: isoRequired(row.created_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function mapShippingOrder(row: {
  id: string;
  shipped_at: Date | string;
  customer: string;
  shipment_number: string;
  carrier_outbound: string;
  shipper_name: string;
  load_pallet_count: number;
  waiting_on_items: boolean;
  items_in_jeopardy: string[];
  status: ShippingOrder["status"];
  pallets: unknown;
  notes: string | null;
  delivery?: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
  division?: string | null;
}): ShippingOrder {
  return {
    id: row.id,
    division: storedDivision(row.division),
    shippedAt: isoRequired(row.shipped_at),
    customer: row.customer,
    shipmentNumber: row.shipment_number,
    carrierOutbound: row.carrier_outbound,
    shipperName: row.shipper_name,
    loadPalletCount: row.load_pallet_count,
    waitingOnItems: row.waiting_on_items,
    itemsInJeopardy: row.items_in_jeopardy ?? [],
    status: row.status,
    pallets: parseStoredPallets(row.pallets),
    notes: row.notes ?? undefined,
    delivery: parseDelivery(row.delivery),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

function parseStoredJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function mapCustomerOrder(row: {
  id: string;
  order_number: string;
  customer: string;
  placed_by: string;
  notes: string | null;
  status: CustomerOrder["status"];
  submitted_at: Date | string;
  lines: unknown;
  print_batch: unknown;
  pick_request: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
  division?: string | null;
}): CustomerOrder {
  return CustomerOrderSchema.parse({
    id: row.id,
    division: storedDivision(row.division),
    orderNumber: row.order_number,
    customer: row.customer,
    placedBy: row.placed_by,
    notes: row.notes ?? undefined,
    status: row.status,
    submittedAt: isoRequired(row.submitted_at),
    lines: parseStoredJson(row.lines) ?? [],
    printBatch: parseStoredJson(row.print_batch),
    pickRequest: parseStoredJson(row.pick_request),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  });
}

export function assembleSystem(parts: {
  rooms: Room[];
  locations: Location[];
  users: User[];
  inventoryItems: InventoryItem[];
  transactions: InventoryTransaction[];
  photos: PhotoAttachment[];
  purchaseOrders: PurchaseOrder[];
  purchaseDocuments?: PurchaseDocument[];
  receivingOrders: ReceivingOrder[];
  shippingOrders: ShippingOrder[];
  customerOrders?: CustomerOrder[];
  itemCubes?: ItemCube[];
  sites?: Site[];
  buildings?: Building[];
  zones?: Zone[];
  aisles?: Aisle[];
  bays?: Bay[];
  trailers?: Trailer[];
  licensePlates?: LicensePlate[];
  licensePlateLedger?: LicensePlateLedger;
  containers?: Container[];
}): InventorySystem {
  return {
    rooms: parts.rooms,
    locations: parts.locations,
    users: parts.users,
    inventoryItems: parts.inventoryItems,
    transactions: parts.transactions,
    photos: parts.photos,
    purchaseOrders: parts.purchaseOrders,
    purchaseDocuments: parts.purchaseDocuments ?? [],
    receivingOrders: parts.receivingOrders,
    shippingOrders: parts.shippingOrders,
    customerOrders: parts.customerOrders ?? [],
    itemCubes: parts.itemCubes ?? [],
    sites: parts.sites ?? [],
    buildings: parts.buildings ?? [],
    zones: parts.zones ?? [],
    aisles: parts.aisles ?? [],
    bays: parts.bays ?? [],
    trailers: parts.trailers ?? [],
    licensePlates: parts.licensePlates ?? [],
    licensePlateLedger: parts.licensePlateLedger,
    containers: parts.containers ?? [],
  };
}

import type {
  InventoryItem,
  Location,
  PurchaseOrder,
  ReceivingOrder,
  Room,
  ShippingOrder,
} from "@/lib/inventory-schema";
import { uniqueSkuCount } from "@/lib/format";
import { jobIdForPurchaseOrder } from "@/lib/purchase-orders";
import { LIMITS } from "@/lib/validation/limits";
import { csvCell } from "@/lib/spreadsheet/csv";

export type ItemReportSource = "on-hand" | "inbound" | "outbound";

export type ItemReportFilters = {
  sku?: string;
  upc?: string;
  poNumber?: string;
  jobIdNumber?: string;
  location?: string;
  description?: string;
};

export type ItemReportRow = {
  id: string;
  sku: string;
  upc: string;
  description: string;
  manufacturer: string;
  color: string | null;
  batch: string | null;
  quantity: number;
  locationCode: string;
  roomName: string;
  source: ItemReportSource;
  sourceLabel: string;
  poNumber?: string;
  jobIdNumber?: string;
  status?: string;
};

export type ItemReport = {
  filters: ItemReportFilters;
  rows: ItemReportRow[];
  totals: {
    lines: number;
    units: number;
    skus: number;
  };
};

const SOURCE_ORDER: Record<ItemReportSource, number> = {
  "on-hand": 0,
  inbound: 1,
  outbound: 2,
};

export function normalizeReportFilters(
  input: ItemReportFilters,
): ItemReportFilters {
  return {
    sku: normalizeFilter(input.sku, LIMITS.sku),
    upc: normalizeFilter(input.upc, LIMITS.upc),
    poNumber: normalizeFilter(input.poNumber, LIMITS.text),
    jobIdNumber: normalizeFilter(input.jobIdNumber, LIMITS.code),
    location: normalizeFilter(input.location, LIMITS.code),
    description: normalizeFilter(input.description, LIMITS.description),
  };
}

export function hasReportFilters(filters: ItemReportFilters): boolean {
  const normalized = normalizeReportFilters(filters);
  return Boolean(
    normalized.sku ||
      normalized.upc ||
      normalized.poNumber ||
      normalized.jobIdNumber ||
      normalized.location ||
      normalized.description,
  );
}

export function containsNeedle(value: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  return (value ?? "").toLowerCase().includes(needle.toLowerCase());
}

export function buildItemCatalog(input: {
  inventoryItems: InventoryItem[];
  locations: Location[];
  rooms: Room[];
  receivingOrders: ReceivingOrder[];
  shippingOrders: ShippingOrder[];
  purchaseOrders?: PurchaseOrder[];
}): ItemReportRow[] {
  const purchaseOrders = input.purchaseOrders ?? [];
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));
  const locations = new Map(
    input.locations.map((location) => [location.id, location]),
  );

  function place(locationId: string | null | undefined): {
    locationCode: string;
    roomName: string;
  } {
    if (!locationId) {
      return { locationCode: "—", roomName: "—" };
    }
    const location = locations.get(locationId);
    const room = location ? rooms.get(location.roomId) : undefined;
    return {
      locationCode: location?.code ?? "UNKNOWN",
      roomName: room?.name ?? "Unknown room",
    };
  }

  const onHand: ItemReportRow[] = input.inventoryItems.map((item) => {
    const slot = place(item.locationId);
    return {
      id: `on-hand:${item.id}`,
      sku: item.sku,
      upc: item.upc ?? "",
      description: item.description ?? item.sku,
      manufacturer: item.manufacturer ?? "",
      color: item.color ?? null,
      batch: item.batch,
      quantity: item.quantity,
      locationCode: slot.locationCode,
      roomName: slot.roomName,
      source: "on-hand",
      sourceLabel: "On hand",
    };
  });

  const inbound: ItemReportRow[] = input.receivingOrders.flatMap((order) =>
    order.pallets.flatMap((pallet) =>
      pallet.cases.map((item) => {
        const slot = item.putawayLocationId
          ? place(item.putawayLocationId)
          : { locationCode: pallet.palletNumber, roomName: "Receiving" };
        const jobIdNumber = jobIdForPurchaseOrder(purchaseOrders, order.poNumber);
        return {
          id: `inbound:${order.id}:${item.id}`,
          sku: item.sku,
          upc: item.upc,
          description: item.description,
          manufacturer: item.manufacturer ?? "",
          color: item.color ?? null,
          batch: item.batch,
          quantity: item.quantityInCase,
          locationCode: slot.locationCode,
          roomName: slot.roomName,
          source: "inbound" as const,
          sourceLabel: jobIdNumber
            ? `PO ${order.poNumber} · Job ${jobIdNumber} · ${order.orderNumber}`
            : `PO ${order.poNumber} · ${order.orderNumber}`,
          poNumber: order.poNumber,
          jobIdNumber: jobIdNumber ?? undefined,
          status: order.status,
        };
      }),
    ),
  );

  const outbound: ItemReportRow[] = input.shippingOrders.flatMap((order) =>
    order.pallets.flatMap((pallet) =>
      pallet.cases.map((item) => {
        const slot = place(item.putawayLocationId);
        return {
          id: `outbound:${order.id}:${item.id}`,
          sku: item.sku,
          upc: item.upc,
          description: item.description,
          manufacturer: item.manufacturer ?? "",
          color: item.color ?? null,
          batch: item.batch,
          quantity: item.quantityInCase,
          locationCode: slot.locationCode,
          roomName: slot.roomName,
          source: "outbound" as const,
          sourceLabel: `Shipment ${order.shipmentNumber}`,
        };
      }),
    ),
  );

  return [...onHand, ...inbound, ...outbound];
}

export function queryItemReport(
  catalog: ItemReportRow[],
  rawFilters: ItemReportFilters,
): ItemReport {
  const filters = normalizeReportFilters(rawFilters);
  if (!hasReportFilters(filters)) {
    return { filters, rows: [], totals: { lines: 0, units: 0, skus: 0 } };
  }

  const relatedSkus = new Set(
    catalog
      .filter((row) => row.source === "inbound" && matchesProject(row, filters))
      .map((row) => row.sku.toLowerCase()),
  );

  const rows = catalog
    .filter((row) => rowMatchesFilters(row, filters, relatedSkus))
    .sort((a, b) => {
      const sku = a.sku.localeCompare(b.sku);
      if (sku !== 0) return sku;
      const source = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
      if (source !== 0) return source;
      return a.locationCode.localeCompare(b.locationCode);
    });

  return {
    filters,
    rows,
    totals: {
      lines: rows.length,
      units: rows.reduce((sum, row) => sum + row.quantity, 0),
      skus: uniqueSkuCount(rows),
    },
  };
}

export function itemReportToCsv(report: ItemReport): string {
  const headers = [
    "SKU",
    "UPC",
    "Description",
    "Manufacturer",
    "Color",
    "Batch",
    "Qty",
    "Location",
    "Room",
    "Source",
    "PO",
    "Job ID",
  ];
  const lines = [
    headers.join(","),
    ...report.rows.map((row) =>
      [
        row.sku,
        row.upc,
        row.description,
        row.manufacturer,
        row.color ?? "",
        row.batch ?? "",
        String(row.quantity),
        row.locationCode,
        row.roomName,
        row.sourceLabel,
        row.poNumber ?? "",
        row.jobIdNumber ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function matchesProject(row: ItemReportRow, filters: ItemReportFilters): boolean {
  if (!filters.poNumber && !filters.jobIdNumber) return false;
  if (filters.poNumber && !containsNeedle(row.poNumber, filters.poNumber)) return false;
  if (filters.jobIdNumber && !containsNeedle(row.jobIdNumber, filters.jobIdNumber)) {
    return false;
  }
  return true;
}

function rowMatchesFilters(
  row: ItemReportRow,
  filters: ItemReportFilters,
  relatedSkus: Set<string>,
): boolean {
  if (filters.sku && !containsNeedle(row.sku, filters.sku)) return false;
  if (filters.upc && !containsNeedle(row.upc, filters.upc)) return false;
  if (filters.description && !containsNeedle(row.description, filters.description)) {
    return false;
  }
  if (
    filters.location &&
    !containsNeedle(row.locationCode, filters.location) &&
    !containsNeedle(row.roomName, filters.location)
  ) {
    return false;
  }
  if (filters.poNumber || filters.jobIdNumber) {
    if (row.source === "inbound") return matchesProject(row, filters);
    return relatedSkus.has(row.sku.toLowerCase());
  }
  return true;
}

function normalizeFilter(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

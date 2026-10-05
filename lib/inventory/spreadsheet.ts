import type {
  FiberItem,
  InventoryItem,
  InventoryRow,
  Location,
  Room,
} from "@/lib/inventory-schema";
import { CONNECTION_TYPES, STRAND_COUNTS } from "@/lib/inventory-schema";
import {
  inventoryDetailsDiffer,
  type InventoryLineDetails,
} from "@/lib/inventory/details";
import { inventoryKey } from "@/lib/inventory/keys";
import { parseCsv, serializeCsv } from "@/lib/spreadsheet/csv";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";
import {
  assertActiveLocation,
  assertFiniteQuantity,
  assertSkuCode,
  assertUpcCode,
} from "@/lib/validation/inventory-guards";
import {
  DescriptionSchema,
  LocationCodeSchema,
  SkuSchema,
  UpcSchema,
} from "@/lib/validation/fields";
import {
  assertProductCodePair,
  type KnownProduct,
} from "@/lib/codes/product-codes";
import { hasControlChars, hasHtmlMarkup } from "@/lib/validation/sanitize";
import { isLargeQuantity } from "@/lib/validation/large-input";

export const INVENTORY_SPREADSHEET_HEADERS = [
  "SKU",
  "UPC",
  "Description",
  "Manufacturer",
  "Color",
  "Batch",
  "Qty",
  "Location",
  "Room",
  "Fiber",
  "Connection",
  "Strand count",
  "Length (m)",
  "Last moved",
] as const;

export type SpreadsheetImportMode = "set" | "add";

export type SpreadsheetImportError = {
  row: number;
  message: string;
};

export type SpreadsheetImportChange = {
  row: number;
  sku: string;
  upc?: string;
  description?: string;
  batch: string | null;
  locationId: string;
  locationCode: string;
  quantityBefore: number;
  quantityAfter: number;
  quantityDelta: number;
  manufacturer?: string;
  color?: string | null;
  fiber?: FiberItem | null;
  action: "create" | "update" | "unchanged";
};

export type ParsedInventorySpreadsheetRow = {
  row: number;
  sku: string;
  upc?: string;
  description?: string;
  manufacturer?: string;
  color?: string;
  batch: string | null;
  quantityText: string;
  locationCode: string;
  roomName?: string;
  fiber?: string;
  connection?: string;
  strandCount?: string;
  lengthMeters?: string;
};

export type SpreadsheetImportPlan = {
  mode: SpreadsheetImportMode;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  unitsDelta: number;
  errors: SpreadsheetImportError[];
  changes: SpreadsheetImportChange[];
  requiresConfirmation: boolean;
};

const HEADER_ALIASES: Record<string, string[]> = {
  sku: ["sku", "item sku", "item", "product sku"],
  upc: ["upc", "barcode", "ean", "gtin"],
  description: ["description", "desc", "item description", "product", "name"],
  batch: ["batch", "lot", "lot number", "batch number"],
  qty: ["qty", "quantity", "qty on hand", "on hand", "count", "units"],
  location: ["location", "location code", "bin", "loc", "bin location"],
  room: ["room", "area"],
  manufacturer: ["manufacturer", "mfr", "brand"],
  color: ["color", "colour"],
  fiber: ["fiber", "fibre", "is fiber", "is fibre"],
  connection: ["connection", "connection type", "connector"],
  strandCount: ["strand count", "strands", "strand"],
  lengthMeters: ["length (m)", "length m", "length meters", "length", "meters"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_/]+/g, " ");
}

function columnIndex(headers: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[field];
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

export function inventorySpreadsheetTemplate(): string {
  return serializeCsv([...INVENTORY_SPREADSHEET_HEADERS], [], { bom: true });
}

export function inventoryRowsToSpreadsheet(rows: InventoryRow[]): string {
  return serializeCsv(
    [...INVENTORY_SPREADSHEET_HEADERS],
    rows.map((row) => [
      row.sku,
      row.upc ?? "",
      row.description ?? "",
      row.manufacturer ?? "",
      row.color ?? "",
      row.batch ?? "",
      row.quantity,
      row.locationCode,
      row.roomName,
      row.fiber?.isFiber ? "Yes" : row.fiber ? "No" : "",
      row.fiber?.connectionType ?? "",
      row.fiber?.strandCount ?? "",
      row.fiber?.lengthMeters ?? "",
      row.lastMovedAt ?? "",
    ]),
    { bom: true },
  );
}

export function parseInventorySpreadsheet(
  text: string,
): ParsedInventorySpreadsheetRow[] {
  const { headers, rows } = parseCsv(text);
  const skuIndex = columnIndex(headers, "sku");
  const qtyIndex = columnIndex(headers, "qty");
  const locationIndex = columnIndex(headers, "location");
  if (skuIndex < 0 || qtyIndex < 0 || locationIndex < 0) {
    throw new ValidationError(
      "Spreadsheet must include SKU, Qty, and Location columns. Download the Saltbox template and keep those headers.",
    );
  }

  const upcIndex = columnIndex(headers, "upc");
  const descriptionIndex = columnIndex(headers, "description");
  const manufacturerIndex = columnIndex(headers, "manufacturer");
  const colorIndex = columnIndex(headers, "color");
  const batchIndex = columnIndex(headers, "batch");
  const roomIndex = columnIndex(headers, "room");
  const fiberIndex = columnIndex(headers, "fiber");
  const connectionIndex = columnIndex(headers, "connection");
  const strandIndex = columnIndex(headers, "strandCount");
  const lengthIndex = columnIndex(headers, "lengthMeters");

  if (rows.length > LIMITS.spreadsheetMaxRows) {
    throw new ValidationError(
      `Spreadsheet cannot exceed ${LIMITS.spreadsheetMaxRows} data rows.`,
    );
  }

  return rows.map((cells, index) => ({
    row: index + 2,
    sku: cellAt(cells, skuIndex),
    upc: optionalCell(cells, upcIndex),
    description: optionalCell(cells, descriptionIndex),
    manufacturer: columnText(cells, manufacturerIndex),
    color: columnText(cells, colorIndex),
    batch: optionalCell(cells, batchIndex) ?? null,
    quantityText: cellAt(cells, qtyIndex),
    locationCode: cellAt(cells, locationIndex),
    roomName: optionalCell(cells, roomIndex),
    fiber: columnText(cells, fiberIndex),
    connection: columnText(cells, connectionIndex),
    strandCount: columnText(cells, strandIndex),
    lengthMeters: columnText(cells, lengthIndex),
  }));
}

export function planInventoryImport(input: {
  rows: ParsedInventorySpreadsheetRow[];
  items: InventoryItem[];
  locations: Location[];
  rooms: Room[];
  products: KnownProduct[];
  mode: SpreadsheetImportMode;
}): SpreadsheetImportPlan {
  const errors: SpreadsheetImportError[] = [];
  const changes: SpreadsheetImportChange[] = [];
  const seen = new Map<string, number>();
  const lines = new Map(
    input.items.map((item) => [
      inventoryKey(item.sku, item.batch, item.locationId),
      item,
    ]),
  );
  const products = [...input.products];
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));

  for (const row of input.rows) {
    const parsed = validateImportRow(row, input.locations, rooms, products, seen);
    if ("error" in parsed) {
      errors.push({ row: row.row, message: parsed.error });
      continue;
    }

    const key = inventoryKey(parsed.sku, parsed.batch, parsed.location.id);
    const existing = lines.get(key);
    const quantityBefore = existing?.quantity ?? 0;
    const exists = existing != null;
    const quantityAfter =
      input.mode === "add" ? quantityBefore + parsed.quantity : parsed.quantity;

    if (input.mode === "add" && parsed.quantity < 1) {
      errors.push({
        row: row.row,
        message: "Add mode requires a quantity of at least 1.",
      });
      continue;
    }

    try {
      assertFiniteQuantity(quantityAfter, "On-hand quantity");
    } catch (error) {
      errors.push({
        row: row.row,
        message: error instanceof Error ? error.message : "Invalid quantity.",
      });
      continue;
    }

    const quantityDelta = quantityAfter - quantityBefore;
    const details = lineDetails(parsed);
    const attributesDiffer = existing
      ? inventoryDetailsDiffer(existing, details)
      : false;
    const action: SpreadsheetImportChange["action"] = !exists
      ? quantityAfter === 0
        ? "unchanged"
        : "create"
      : quantityDelta === 0 && !attributesDiffer
        ? "unchanged"
        : "update";

    lines.set(key, {
      id: existing?.id ?? "00000000-0000-4000-8000-000000000000",
      sku: parsed.sku,
      upc: parsed.upc ?? existing?.upc,
      batch: parsed.batch,
      locationId: parsed.location.id,
      quantity: quantityAfter,
      description: parsed.description ?? existing?.description,
      manufacturer:
        parsed.manufacturer !== undefined
          ? parsed.manufacturer
          : (existing?.manufacturer ?? ""),
      color: parsed.color !== undefined ? parsed.color : (existing?.color ?? null),
      fiber: parsed.fiber !== undefined ? parsed.fiber : (existing?.fiber ?? null),
      lastMovedAt: existing?.lastMovedAt,
      updatedAt: existing?.updatedAt,
    });
    if (parsed.upc) {
      products.push({
        sku: parsed.sku,
        upc: parsed.upc,
        description: parsed.description || parsed.sku,
      });
    }

    changes.push({
      row: row.row,
      sku: parsed.sku,
      upc: parsed.upc,
      description: parsed.description,
      batch: parsed.batch,
      locationId: parsed.location.id,
      locationCode: parsed.location.code,
      quantityBefore,
      quantityAfter,
      quantityDelta,
      manufacturer: parsed.manufacturer,
      color: parsed.color,
      fiber: parsed.fiber,
      action,
    });
  }

  const unitsDelta = changes.reduce((sum, change) => sum + change.quantityDelta, 0);

  return {
    mode: input.mode,
    rowsRead: input.rows.length,
    created: changes.filter((change) => change.action === "create").length,
    updated: changes.filter((change) => change.action === "update").length,
    unchanged: changes.filter((change) => change.action === "unchanged").length,
    unitsDelta,
    errors,
    changes,
    requiresConfirmation: isLargeQuantity(Math.abs(unitsDelta)),
  };
}

export function formatImportErrors(errors: SpreadsheetImportError[]): string {
  const preview = errors
    .slice(0, 5)
    .map((error) => `Row ${error.row}: ${error.message}`)
    .join(" ");
  if (errors.length === 1) return preview;
  return `Fix ${errors.length} spreadsheet errors before importing. ${preview}`;
}

export function assertImportPlanReady(plan: SpreadsheetImportPlan): void {
  if (plan.errors.length > 0) {
    throw new ValidationError(formatImportErrors(plan.errors));
  }
  if (plan.created === 0 && plan.updated === 0) {
    throw new ValidationError(
      "Spreadsheet matches on-hand inventory. Nothing to import.",
    );
  }
}

export function spreadsheetFileName(kind: "inventory" | "template" = "inventory"): string {
  if (kind === "template") return "saltbox-inventory-template.csv";
  const stamp = new Date().toISOString().slice(0, 10);
  return `saltbox-inventory-${stamp}.csv`;
}

function validateImportRow(
  row: ParsedInventorySpreadsheetRow,
  locations: Location[],
  rooms: Map<string, Room>,
  products: KnownProduct[],
  seen: Map<string, number>,
):
  | {
      sku: string;
      upc?: string;
      description?: string;
      manufacturer?: string;
      color?: string | null;
      fiber?: FiberItem | null;
      batch: string | null;
      quantity: number;
      location: Location;
    }
  | { error: string } {
  if (!row.sku) return { error: "SKU is required." };
  if (!row.locationCode) return { error: "Location is required." };

  const quantity = parseQuantityValue(row.quantityText);
  if (quantity === null) {
    return { error: "Qty is required and must be a whole number." };
  }

  const skuParsed = SkuSchema.safeParse(row.sku);
  if (!skuParsed.success) {
    return {
      error:
        "SKU may only include letters, numbers, dots, underscores, slashes, and hyphens.",
    };
  }
  try {
    assertSkuCode(skuParsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid SKU." };
  }

  let upc: string | undefined;
  if (row.upc) {
    const upcParsed = UpcSchema.safeParse(row.upc);
    if (!upcParsed.success) {
      return { error: "UPC may only include letters, numbers, and hyphens." };
    }
    try {
      assertUpcCode(upcParsed.data);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid UPC." };
    }
    upc = upcParsed.data;
  }

  let description: string | undefined;
  if (row.description) {
    const descriptionParsed = DescriptionSchema.safeParse(row.description);
    if (!descriptionParsed.success) {
      return { error: "Description contains invalid characters or is too long." };
    }
    description = descriptionParsed.data;
  }

  let batch = row.batch?.trim() || null;
  if (batch === "") batch = null;
  if (batch && batch.length > LIMITS.code) {
    return { error: "Batch is too long." };
  }
  if (batch && (hasHtmlMarkup(batch) || hasControlChars(batch))) {
    return { error: "Batch contains invalid characters." };
  }

  const attributes = parseLineAttributes(row);
  if ("error" in attributes) return { error: attributes.error };

  const locationCodeParsed = LocationCodeSchema.safeParse(row.locationCode);
  if (!locationCodeParsed.success) {
    return { error: "Location code is invalid." };
  }

  let location: Location;
  try {
    location = assertActiveLocation(
      findLocationByCode(locations, locationCodeParsed.data),
      "spreadsheet import",
    );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : `Location ${row.locationCode} was not found.`,
    };
  }

  if (row.roomName) {
    const room = rooms.get(location.roomId);
    if (room && room.name.trim().toLowerCase() !== row.roomName.trim().toLowerCase()) {
      return {
        error: `Location ${location.code} is in ${room.name}, not ${row.roomName}.`,
      };
    }
  }

  const key = inventoryKey(skuParsed.data, batch, location.id);
  const duplicateRow = seen.get(key);
  if (duplicateRow) {
    return {
      error: `Duplicate SKU, batch, and location (already on row ${duplicateRow}).`,
    };
  }
  seen.set(key, row.row);

  if (upc) {
    try {
      assertProductCodePair(skuParsed.data, upc, products);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "SKU/UPC conflict." };
    }
  } else {
    const known = products.find(
      (product) => product.sku.toLowerCase() === skuParsed.data.toLowerCase(),
    );
    if (known) upc = known.upc;
  }

  return {
    sku: skuParsed.data,
    upc,
    description,
    manufacturer: attributes.manufacturer,
    color: attributes.color,
    fiber: attributes.fiber,
    batch,
    quantity,
    location,
  };
}

export function findLocationByCode(
  locations: Location[],
  code: string,
): Location | undefined {
  const needle = code.trim().toLowerCase();
  return locations.find((location) => location.code.toLowerCase() === needle);
}

function cellAt(cells: string[], index: number): string {
  return (cells[index] ?? "").trim();
}

function optionalCell(cells: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  const value = cellAt(cells, index);
  return value || undefined;
}

function columnText(cells: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  return cellAt(cells, index);
}

function lineDetails(parsed: {
  manufacturer?: string;
  color?: string | null;
  fiber?: FiberItem | null;
}): InventoryLineDetails | undefined {
  const details: InventoryLineDetails = {};
  if (parsed.manufacturer !== undefined) details.manufacturer = parsed.manufacturer;
  if (parsed.color !== undefined) details.color = parsed.color;
  if (parsed.fiber !== undefined) details.fiber = parsed.fiber;
  return Object.keys(details).length > 0 ? details : undefined;
}

function parseYesNo(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["yes", "y", "true", "1", "fiber"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
}

function parseLineAttributes(row: ParsedInventorySpreadsheetRow):
  | { manufacturer?: string; color?: string | null; fiber?: FiberItem | null }
  | { error: string } {
  let manufacturer: string | undefined;
  if (row.manufacturer !== undefined) {
    if (row.manufacturer && (hasHtmlMarkup(row.manufacturer) || hasControlChars(row.manufacturer))) {
      return { error: "Manufacturer contains invalid characters." };
    }
    if (row.manufacturer.length > LIMITS.text) {
      return { error: "Manufacturer is too long." };
    }
    manufacturer = row.manufacturer;
  }

  let color: string | null | undefined;
  if (row.color !== undefined) {
    if (row.color && (hasHtmlMarkup(row.color) || hasControlChars(row.color))) {
      return { error: "Color contains invalid characters." };
    }
    if (row.color.length > LIMITS.code) {
      return { error: "Color is too long." };
    }
    color = row.color || null;
  }

  const fiberColumns = [row.fiber, row.connection, row.strandCount, row.lengthMeters];
  if (fiberColumns.every((value) => value === undefined)) {
    return { manufacturer, color };
  }

  let isFiber: boolean | null = null;
  if (row.fiber) {
    isFiber = parseYesNo(row.fiber);
    if (isFiber === null) return { error: "Fiber must be Yes or No." };
  }

  let connectionType: FiberItem["connectionType"] = null;
  if (row.connection) {
    const match = CONNECTION_TYPES.find(
      (option) => option.toLowerCase() === row.connection?.toLowerCase(),
    );
    if (!match) {
      return {
        error: `Connection must be one of ${CONNECTION_TYPES.join(", ")}.`,
      };
    }
    connectionType = match;
  }

  let strandCount: number | null = null;
  if (row.strandCount) {
    const strand = Number(row.strandCount);
    if (!STRAND_COUNTS.includes(strand as (typeof STRAND_COUNTS)[number])) {
      return {
        error: `Strand count must be one of ${STRAND_COUNTS.join(", ")}.`,
      };
    }
    strandCount = strand;
  }

  let lengthMeters: number | null = null;
  if (row.lengthMeters) {
    const length = Number(row.lengthMeters);
    if (!Number.isFinite(length) || length < 0) {
      return { error: "Length (m) must be a number zero or greater." };
    }
    lengthMeters = length;
  }

  const hasDetails = Boolean(connectionType || strandCount != null || lengthMeters != null);
  if (isFiber === false && hasDetails) {
    return {
      error: "Clear connection, strand count, and length when Fiber is No.",
    };
  }
  if (isFiber === null && !hasDetails) {
    return { manufacturer, color, fiber: null };
  }

  return {
    manufacturer,
    color,
    fiber: {
      isFiber: isFiber ?? true,
      connectionType,
      strandCount,
      lengthMeters,
    },
  };
}

function parseQuantityValue(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const quantity = Number(normalized);
  try {
    assertFiniteQuantity(quantity, "Qty");
  } catch {
    return null;
  }
  return quantity;
}

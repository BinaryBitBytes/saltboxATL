import type { CustomerOrder, CustomerOrderLine } from "@/lib/inventory-schema";
import type { WarehouseLabel } from "@/lib/labels/build-labels";
import { encodeScanPayload } from "@/lib/scan-code";
import { uniqueSkuCount } from "@/lib/format";

export const DEFAULT_WAREHOUSE_LABEL_PRINTER = "WH-LABEL-01";

export function warehouseLabelPrinterName(
  configured = process.env.WAREHOUSE_LABEL_PRINTER,
): string {
  const name = configured?.trim();
  return name || DEFAULT_WAREHOUSE_LABEL_PRINTER;
}

export type OrderDocumentLine = {
  id: string;
  sku: string;
  upc: string;
  description: string;
  manufacturer: string;
  color: string | null;
  batch: string | null;
  quantity: number;
  locationCode: string;
};

export type OrderPackSlip = {
  orderId: string;
  orderNumber: string;
  customer: string;
  placedBy: string;
  submittedAt: string;
  notes: string;
  lines: OrderDocumentLine[];
  totalUnits: number;
  totalLines: number;
  skuCount: number;
};

export type OrderLoadingLocation = {
  locationCode: string;
  lines: OrderDocumentLine[];
  unitCount: number;
};

export type OrderLoadingSheet = {
  orderId: string;
  orderNumber: string;
  customer: string;
  placedBy: string;
  pickRequestNumber: string;
  printerName: string;
  submittedAt: string;
  notes: string;
  locations: OrderLoadingLocation[];
  totals: {
    locations: number;
    lines: number;
    skus: number;
    units: number;
  };
};

function documentLines(
  lines: CustomerOrderLine[],
  locationCodes: Map<string, string>,
): OrderDocumentLine[] {
  return lines.map((line) => ({
    id: line.id,
    sku: line.sku,
    upc: line.upc,
    description: line.description,
    manufacturer: line.manufacturer,
    color: line.color,
    batch: line.batch,
    quantity: line.quantity,
    locationCode: locationCodes.get(line.locationId) ?? line.locationId,
  }));
}

export function buildOrderItemLabels(
  order: CustomerOrder,
  locationCodes: Map<string, string>,
): WarehouseLabel[] {
  return order.lines.map((line) => ({
    id: line.id,
    kind: "order" as const,
    heading: "Pick label",
    title: line.sku,
    barcodeValue: line.upc || line.sku,
    qrValue: encodeScanPayload({
      sku: line.sku,
      upc: line.upc,
      batch: line.batch,
    }),
    fields: [
      { label: "Order", value: order.orderNumber },
      { label: "Customer", value: order.customer },
      { label: "Pick", value: order.pickRequest.requestNumber },
      { label: "UPC", value: line.upc },
      { label: "Qty", value: String(line.quantity) },
      { label: "Batch", value: line.batch || "—" },
      { label: "Manufacturer", value: line.manufacturer || "—" },
      { label: "Color", value: line.color || "—" },
      {
        label: "From",
        value: locationCodes.get(line.locationId) ?? line.locationId,
      },
      { label: "Item", value: line.description },
    ],
  }));
}

export function buildOrderPackSlip(
  order: CustomerOrder,
  locationCodes: Map<string, string>,
): OrderPackSlip {
  const lines = documentLines(order.lines, locationCodes);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    placedBy: order.placedBy,
    submittedAt: order.submittedAt,
    notes: order.notes ?? "",
    lines,
    totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalLines: lines.length,
    skuCount: uniqueSkuCount(lines),
  };
}

export function buildOrderLoadingSheet(
  order: CustomerOrder,
  locationCodes: Map<string, string>,
): OrderLoadingSheet {
  const lines = documentLines(order.lines, locationCodes);
  const byLocation = new Map<string, OrderDocumentLine[]>();
  for (const line of lines) {
    const group = byLocation.get(line.locationCode) ?? [];
    group.push(line);
    byLocation.set(line.locationCode, group);
  }
  const locations = [...byLocation.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([locationCode, group]) => ({
      locationCode,
      lines: group,
      unitCount: group.reduce((sum, line) => sum + line.quantity, 0),
    }));

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    placedBy: order.placedBy,
    pickRequestNumber: order.pickRequest.requestNumber,
    printerName: order.printBatch.printerName,
    submittedAt: order.submittedAt,
    notes: order.notes ?? "",
    locations,
    totals: {
      locations: locations.length,
      lines: lines.length,
      skus: uniqueSkuCount(lines),
      units: lines.reduce((sum, line) => sum + line.quantity, 0),
    },
  };
}

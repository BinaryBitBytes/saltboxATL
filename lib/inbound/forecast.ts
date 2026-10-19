import type { PurchaseOrder, ReceivingOrder } from "@/lib/inventory-schema";
import { isCoordinatorPurchaseOrder } from "@/lib/purchase-orders";

export type DerivedInboundStatus =
  | "expected"
  | "in-transit"
  | "receiving"
  | "received"
  | "cancelled";

export type InboundForecastLine = {
  sku: string;
  upc: string;
  description: string;
  quantity: number;
  receivedQuantity: number;
};

export type InboundForecastRow = {
  id: string;
  purchaseOrderNumber: string;
  projectId: string | null;
  jobIdNumber: string | null;
  vendor: string;
  carrier: string;
  expectedArrivalAt: string | null;
  buyerName: string | null;
  notes: string;
  expectedPalletCount: number;
  expectedUnits: number;
  receivedUnits: number;
  derivedStatus: DerivedInboundStatus;
  lines: InboundForecastLine[];
  uploadedBy: string | null;
};

export type InboundForecast = {
  rows: InboundForecastRow[];
  upcomingCount: number;
  upcomingUnits: number;
  awaitingJobId: number;
  byCarrier: Array<{ carrier: string; orders: number; units: number }>;
  byVendor: Array<{ vendor: string; orders: number; units: number }>;
};

/** Imported invoice loads stay expected until the dock checks them in. */
export function isExpectedIntake(order: {
  intake?: string | null;
  status: string;
}): boolean {
  return order.intake === "expected" && order.status === "draft";
}

function countsAsReceived(order: ReceivingOrder): boolean {
  return order.status !== "cancelled" && !isExpectedIntake(order);
}

function receivedQuantityForSku(
  receivingOrders: ReceivingOrder[],
  purchaseOrderNumber: string,
  sku: string,
): number {
  if (!sku) return 0;
  return receivingOrders
    .filter(
      (order) =>
        order.poNumber === purchaseOrderNumber && countsAsReceived(order),
    )
    .flatMap((order) => order.pallets.flatMap((pallet) => pallet.cases))
    .filter((item) => item.sku === sku)
    .reduce((sum, item) => sum + item.quantityInCase, 0);
}

function receivedUnitsForPo(
  receivingOrders: ReceivingOrder[],
  purchaseOrderNumber: string,
): number {
  return receivingOrders
    .filter(
      (order) =>
        order.poNumber === purchaseOrderNumber && countsAsReceived(order),
    )
    .flatMap((order) => order.pallets.flatMap((pallet) => pallet.cases))
    .reduce((sum, item) => sum + item.quantityInCase, 0);
}

export function derivedInboundStatus(
  order: PurchaseOrder,
  receivingOrders: ReceivingOrder[],
): DerivedInboundStatus {
  if (order.expectationStatus === "cancelled") return "cancelled";
  const related = receivingOrders.filter(
    (entry) =>
      entry.poNumber === order.purchaseOrderNumber &&
      entry.status !== "cancelled",
  );
  if (
    related.some(
      (entry) => entry.status === "received" || entry.status === "completed",
    )
  ) {
    return "received";
  }
  if (
    related.some(
      (entry) =>
        entry.status === "in-progress" ||
        (entry.status === "draft" && !isExpectedIntake(entry)),
    )
  ) {
    return "receiving";
  }
  if (order.expectationStatus === "in-transit") return "in-transit";
  return "expected";
}

export function inboundStatusLabel(status: DerivedInboundStatus): string {
  if (status === "in-transit") return "In transit";
  if (status === "receiving") return "Receiving";
  if (status === "received") return "Received";
  if (status === "cancelled") return "Cancelled";
  return "Expected";
}

function isUpcoming(status: DerivedInboundStatus): boolean {
  return status === "expected" || status === "in-transit" || status === "receiving";
}

function groupBy(
  rows: InboundForecastRow[],
  key: "carrier" | "vendor",
): Array<{ name: string; orders: number; units: number }> {
  const groups = new Map<string, { orders: number; units: number }>();
  for (const row of rows) {
    if (!isUpcoming(row.derivedStatus)) continue;
    const name = row[key] || "Unspecified";
    const current = groups.get(name) ?? { orders: 0, units: 0 };
    current.orders += 1;
    current.units += row.expectedUnits;
    groups.set(name, current);
  }
  return [...groups.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.units - left.units || left.name.localeCompare(right.name));
}

export function buildInboundForecast(
  purchaseOrders: PurchaseOrder[],
  receivingOrders: ReceivingOrder[],
): InboundForecast {
  const rows = purchaseOrders
    .filter(isCoordinatorPurchaseOrder)
    .map((order): InboundForecastRow => {
      const lines = (order.lines ?? []).map((line) => ({
        sku: line.sku,
        upc: line.upc,
        description: line.description,
        quantity: line.quantity,
        receivedQuantity: receivedQuantityForSku(
          receivingOrders,
          order.purchaseOrderNumber,
          line.sku,
        ),
      }));
      return {
        id: order.id,
        purchaseOrderNumber: order.purchaseOrderNumber,
        projectId: order.projectId ?? null,
        jobIdNumber: order.jobIdNumber ?? null,
        vendor: order.vendor?.trim() || "Unspecified vendor",
        carrier: order.carrier?.trim() || "Unspecified carrier",
        expectedArrivalAt: order.expectedArrivalAt ?? null,
        buyerName: order.buyerName ?? null,
        notes: order.expectationNotes ?? "",
        expectedPalletCount: order.expectedPalletCount ?? 0,
        expectedUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
        receivedUnits: receivedUnitsForPo(
          receivingOrders,
          order.purchaseOrderNumber,
        ),
        derivedStatus: derivedInboundStatus(order, receivingOrders),
        lines,
        uploadedBy: order.uploadedBy ?? null,
      };
    })
    .sort((left, right) => {
      if (left.expectedArrivalAt && right.expectedArrivalAt) {
        return left.expectedArrivalAt.localeCompare(right.expectedArrivalAt);
      }
      if (left.expectedArrivalAt) return -1;
      if (right.expectedArrivalAt) return 1;
      return left.purchaseOrderNumber.localeCompare(right.purchaseOrderNumber);
    });

  const upcoming = rows.filter((row) => isUpcoming(row.derivedStatus));
  return {
    rows,
    upcomingCount: upcoming.length,
    upcomingUnits: upcoming.reduce((sum, row) => sum + row.expectedUnits, 0),
    awaitingJobId: upcoming.filter((row) => !row.jobIdNumber).length,
    byCarrier: groupBy(rows, "carrier").map((entry) => ({
      carrier: entry.name,
      orders: entry.orders,
      units: entry.units,
    })),
    byVendor: groupBy(rows, "vendor").map((entry) => ({
      vendor: entry.name,
      orders: entry.orders,
      units: entry.units,
    })),
  };
}

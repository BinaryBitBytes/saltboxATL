import type { ShippingOrder } from "@/lib/inventory-schema";
import { uniqueSkuCount } from "@/lib/format";

export type ShipmentLine = {
  caseId: string;
  sku: string;
  upc: string;
  description: string;
  batch: string | null;
  quantity: number;
  fromLocation: string;
  palletNumber: string;
};

export type PackSlipDocument = {
  kind: "pack-slip";
  shipmentId: string;
  shipmentNumber: string;
  customer: string;
  carrier: string;
  shipperName: string;
  shippedAt: string;
  notes: string;
  lines: ShipmentLine[];
  totalUnits: number;
  totalLines: number;
  palletCount: number;
  skuCount: number;
};

export type ManifestPallet = {
  palletNumber: string;
  caseCount: number;
  skuCount: number;
  unitCount: number;
  lines: ShipmentLine[];
};

export type LoadManifestDocument = {
  kind: "load-manifest";
  shipmentId: string;
  shipmentNumber: string;
  customer: string;
  carrier: string;
  shipperName: string;
  shippedAt: string;
  notes: string;
  pallets: ManifestPallet[];
  totals: {
    pallets: number;
    cases: number;
    skus: number;
    units: number;
  };
};

export function shipmentLines(
  order: ShippingOrder,
  locationCodes: Map<string, string>,
): ShipmentLine[] {
  return order.pallets.flatMap((pallet) =>
    pallet.cases.map((item) => ({
      caseId: item.id,
      sku: item.sku,
      upc: item.upc,
      description: item.description,
      batch: item.batch,
      quantity: item.quantityInCase,
      fromLocation: item.putawayLocationId
        ? (locationCodes.get(item.putawayLocationId) ?? item.putawayLocationId)
        : "—",
      palletNumber: pallet.palletNumber,
    })),
  );
}

export function buildPackSlip(
  order: ShippingOrder,
  locationCodes: Map<string, string>,
): PackSlipDocument {
  const lines = shipmentLines(order, locationCodes);
  return {
    kind: "pack-slip",
    shipmentId: order.id,
    shipmentNumber: order.shipmentNumber,
    customer: order.customer,
    carrier: order.carrierOutbound,
    shipperName: order.shipperName,
    shippedAt: order.shippedAt,
    notes: order.notes ?? "",
    lines,
    totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalLines: lines.length,
    palletCount: order.pallets.length,
    skuCount: uniqueSkuCount(lines),
  };
}

export function buildLoadManifest(
  order: ShippingOrder,
  locationCodes: Map<string, string>,
): LoadManifestDocument {
  const pallets: ManifestPallet[] = order.pallets.map((pallet) => {
    const lines = pallet.cases.map((item) => ({
      caseId: item.id,
      sku: item.sku,
      upc: item.upc,
      description: item.description,
      batch: item.batch,
      quantity: item.quantityInCase,
      fromLocation: item.putawayLocationId
        ? (locationCodes.get(item.putawayLocationId) ?? item.putawayLocationId)
        : "—",
      palletNumber: pallet.palletNumber,
    }));
    return {
      palletNumber: pallet.palletNumber,
      caseCount: lines.length,
      skuCount: uniqueSkuCount(lines),
      unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      lines,
    };
  });

  return {
    kind: "load-manifest",
    shipmentId: order.id,
    shipmentNumber: order.shipmentNumber,
    customer: order.customer,
    carrier: order.carrierOutbound,
    shipperName: order.shipperName,
    shippedAt: order.shippedAt,
    notes: order.notes ?? "",
    pallets,
    totals: {
      pallets: pallets.length,
      cases: pallets.reduce((sum, pallet) => sum + pallet.caseCount, 0),
      skus: uniqueSkuCount(pallets.flatMap((pallet) => pallet.lines)),
      units: pallets.reduce((sum, pallet) => sum + pallet.unitCount, 0),
    },
  };
}

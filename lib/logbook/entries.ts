import type {
  InventoryTransaction,
  PhotoAttachment,
  ReceivingOrder,
  ShippingOrder,
} from "@/lib/inventory-schema";
import type { PackSlipDocument, LoadManifestDocument } from "@/lib/shipping/documents";
import { buildLoadManifest, buildPackSlip } from "@/lib/shipping/documents";
import { photosForOwner } from "@/lib/photos/query";

export type LogbookKind = "shipment" | "delivery" | "damage";

export type LogbookLine = {
  sku: string;
  description?: string;
  quantity: number;
  location?: string;
  batch?: string | null;
};

export type LogbookEntry = {
  id: string;
  kind: LogbookKind;
  occurredAt: string;
  title: string;
  subtitle: string;
  status?: string;
  actor?: string;
  carrier?: string;
  notes?: string;
  reason?: string;
  photos: PhotoAttachment[];
  lines: LogbookLine[];
  totals: {
    units: number;
    lines: number;
    pallets?: number;
  };
  href?: string;
  packSlip?: PackSlipDocument;
  manifest?: LoadManifestDocument;
};

export function buildLogbookEntries(input: {
  receivingOrders: ReceivingOrder[];
  shippingOrders: ShippingOrder[];
  transactions: InventoryTransaction[];
  photos: PhotoAttachment[];
  locationCodes: Map<string, string>;
}): LogbookEntry[] {
  const photos = input.photos ?? [];
  const deliveries: LogbookEntry[] = input.receivingOrders.map((order) => {
    const lines = order.pallets.flatMap((pallet) =>
      pallet.cases.map((item) => ({
        sku: item.sku,
        description: item.description,
        quantity: item.quantityInCase,
        location: pallet.palletNumber,
        batch: item.batch,
      })),
    );
    return {
      id: `delivery:${order.id}`,
      kind: "delivery" as const,
      occurredAt: order.receivedAt,
      title: `Delivery ${order.orderNumber}`,
      subtitle: `PO ${order.poNumber} · ${order.vendor}`,
      status: order.status,
      actor: order.receiverName,
      carrier: order.carrierInbound,
      notes: order.notes,
      photos: photosForOwner(photos, "receiving-order", order.id),
      lines,
      totals: {
        units: lines.reduce((sum, line) => sum + line.quantity, 0),
        lines: lines.length,
        pallets: order.pallets.length,
      },
      href: `/receiving/${order.id}`,
    };
  });

  const shipments: LogbookEntry[] = input.shippingOrders.map((order) => {
    const packSlip = buildPackSlip(order, input.locationCodes);
    const manifest = buildLoadManifest(order, input.locationCodes);
    return {
      id: `shipment:${order.id}`,
      kind: "shipment" as const,
      occurredAt: order.shippedAt,
      title: `Shipment ${order.shipmentNumber}`,
      subtitle: `${order.customer} · ${order.carrierOutbound}`,
      status: order.status,
      actor: order.shipperName,
      carrier: order.carrierOutbound,
      notes: order.notes,
      photos: photosForOwner(photos, "shipping-order", order.id),
      lines: packSlip.lines.map((line) => ({
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        location: line.fromLocation,
        batch: line.batch,
      })),
      totals: {
        units: packSlip.totalUnits,
        lines: packSlip.totalLines,
        pallets: packSlip.palletCount,
      },
      href: `/shipping/${order.id}`,
      packSlip,
      manifest,
    };
  });

  const damageGroups = new Map<string, InventoryTransaction[]>();
  for (const entry of input.transactions) {
    if (entry.type !== "damage") continue;
    const key = entry.referenceId ?? entry.id;
    const group = damageGroups.get(key) ?? [];
    group.push(entry);
    damageGroups.set(key, group);
  }

  const damages: LogbookEntry[] = [...damageGroups.entries()].map(
    ([referenceId, group]) => {
      const outbound = group.filter((entry) => entry.quantityDelta < 0);
      const linesSource = outbound.length > 0 ? outbound : group;
      const first = linesSource[0] ?? group[0];
      const lines = linesSource.map((entry) => ({
        sku: entry.sku,
        description: entry.notes,
        quantity: Math.abs(entry.quantityDelta),
        location:
          (entry.destinationLocationId
            ? input.locationCodes.get(entry.destinationLocationId)
            : undefined) ??
          (entry.locationId
            ? input.locationCodes.get(entry.locationId)
            : undefined),
        batch: entry.batch,
      }));
      return {
        id: `damage:${referenceId}`,
        kind: "damage" as const,
        occurredAt: first.occurredAt,
        title: `Damage ${first.sku}`,
        subtitle: first.reason || "Damaged inventory",
        actor: first.createdBy,
        notes: first.notes,
        reason: first.reason,
        photos: photosForOwner(photos, "adjustment", referenceId),
        lines,
        totals: {
          units: lines.reduce((sum, line) => sum + line.quantity, 0),
          lines: lines.length,
        },
        href: "/inventory",
      };
    },
  );

  return [...deliveries, ...shipments, ...damages].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
}

import type { Location, ReceivingOrder, Room, ShippingOrder } from "@/lib/inventory-schema";
import { encodeLocationPayload, encodeScanPayload } from "@/lib/scan-code";

export type WarehouseLabelKind = "inbound" | "outbound" | "location";

export type WarehouseLabel = {
  id: string;
  kind: WarehouseLabelKind;
  heading: string;
  title: string;
  barcodeValue: string;
  qrValue: string;
  fields: Array<{ label: string; value: string }>;
};

export function buildInboundLabels(order: ReceivingOrder): WarehouseLabel[] {
  return order.pallets.flatMap((pallet) =>
    pallet.cases.map((item) => ({
      id: item.id,
      kind: "inbound" as const,
      heading: "Inbound freight",
      title: item.sku,
      barcodeValue: item.upc || item.sku,
      qrValue: encodeScanPayload({
        sku: item.sku,
        upc: item.upc,
        batch: item.batch,
      }),
      fields: [
        { label: "Order", value: order.orderNumber },
        { label: "PO", value: order.poNumber },
        { label: "Vendor", value: order.vendor },
        { label: "Pallet", value: pallet.palletNumber },
        { label: "Tracking", value: pallet.trackingNumber || "—" },
        { label: "UPC", value: item.upc },
        { label: "Qty", value: String(item.quantityInCase) },
        { label: "Batch", value: item.batch || "—" },
        { label: "Manufacturer", value: item.manufacturer || "—" },
        { label: "Color", value: item.color || "—" },
        { label: "Item", value: item.description },
      ],
    })),
  );
}

export function buildOutboundLabels(
  order: ShippingOrder,
  locationCodes: Map<string, string>,
): WarehouseLabel[] {
  return order.pallets.flatMap((pallet) =>
    pallet.cases.map((item) => ({
      id: item.id,
      kind: "outbound" as const,
      heading: "Outbound freight",
      title: item.sku,
      barcodeValue: item.upc || item.sku,
      qrValue: encodeScanPayload({
        sku: item.sku,
        upc: item.upc,
        batch: item.batch,
      }),
      fields: [
        { label: "Shipment", value: order.shipmentNumber },
        { label: "Customer", value: order.customer },
        { label: "Carrier", value: order.carrierOutbound },
        { label: "Pallet", value: pallet.palletNumber },
        { label: "Tracking", value: pallet.trackingNumber || "—" },
        { label: "UPC", value: item.upc },
        { label: "Qty", value: String(item.quantityInCase) },
        { label: "Manufacturer", value: item.manufacturer || "—" },
        { label: "Color", value: item.color || "—" },
        {
          label: "From",
          value: item.putawayLocationId
            ? (locationCodes.get(item.putawayLocationId) ?? item.putawayLocationId)
            : "—",
        },
        { label: "Item", value: item.description },
      ],
    })),
  );
}

export function buildLocationLabels(
  locations: Array<Location & { roomName: string }>,
): WarehouseLabel[] {
  return locations.map((location) => ({
    id: location.id,
    kind: "location" as const,
    heading: "Location",
    title: location.code,
    barcodeValue: location.code,
    qrValue: encodeLocationPayload({
      code: location.code,
      room: location.roomName,
    }),
    fields: [
      { label: "Room", value: location.roomName },
      { label: "Code", value: location.code },
      { label: "Status", value: location.isActive ? "Active" : "Inactive" },
      { label: "Notes", value: location.description || "—" },
    ],
  }));
}

export function locationsWithRooms(
  locations: Location[],
  rooms: Room[],
): Array<Location & { roomName: string }> {
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  return locations.map((location) => ({
    ...location,
    roomName: roomNames.get(location.roomId) ?? "Unknown room",
  }));
}

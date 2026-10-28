import type { Location, ReceivingOrder, Room, ShippingOrder } from "@/lib/inventory-schema";
import { parsePlateNumber } from "@/lib/license-plate/sequence";
import { parseBinCode } from "@/lib/locations/nomenclature";
import {
  encodeHandlingPayload,
  encodeLocationPayload,
  encodeScanPayload,
} from "@/lib/scan-code";

export type WarehouseLabelKind = "inbound" | "outbound" | "location" | "order";

export type WarehouseLabel = {
  id: string;
  kind: WarehouseLabelKind;
  heading: string;
  title: string;
  barcodeValue: string;
  qrValue: string;
  /** Eight-digit plate printed under its own barcode. */
  licensePlateNumber?: string | null;
  /** Value encoded by the license plate barcode. */
  licensePlateBarcode?: string | null;
  fields: Array<{ label: string; value: string }>;
};

/** Barcode field plus the human-readable number that sits under it. */
export function licensePlateTag(
  label: Pick<WarehouseLabel, "licensePlateNumber" | "licensePlateBarcode">,
): { barcode: string; number: string } | null {
  const number = parsePlateNumber(label.licensePlateNumber);
  if (!number) return null;
  const barcode = label.licensePlateBarcode?.trim() || number;
  return { barcode, number };
}

function plateFields(number: string | null | undefined): Array<{ label: string; value: string }> {
  const plate = parsePlateNumber(number);
  if (!plate) return [];
  return [{ label: "License plate", value: plate }];
}

export function buildInboundLabels(
  order: ReceivingOrder,
  jobIdNumber?: string | null,
): WarehouseLabel[] {
  const jobId = jobIdNumber?.trim();
  return order.pallets.flatMap((pallet) =>
    pallet.cases.map((item) => ({
      id: item.id,
      kind: "inbound" as const,
      heading: "Inbound freight",
      title: item.sku,
      barcodeValue: item.upc || item.sku,
      licensePlateNumber: parsePlateNumber(item.licensePlateNumber),
      licensePlateBarcode: parsePlateNumber(item.licensePlateNumber),
      qrValue: encodeScanPayload({
        sku: item.sku,
        upc: item.upc,
        batch: item.batch,
        licensePlateNumber: item.licensePlateNumber,
      }),
      fields: [
        { label: "Order", value: order.orderNumber },
        { label: "PO", value: order.poNumber },
        ...(jobId ? [{ label: "Job ID", value: jobId }] : []),
        { label: "Vendor", value: order.vendor },
        { label: "Pallet", value: pallet.palletNumber },
        { label: "Tracking", value: pallet.trackingNumber || "—" },
        { label: "UPC", value: item.upc },
        { label: "Qty", value: String(item.quantityInCase) },
        { label: "Batch", value: item.batch || "—" },
        { label: "Manufacturer", value: item.manufacturer || "—" },
        { label: "Color", value: item.color || "—" },
        ...plateFields(item.licensePlateNumber),
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
      licensePlateNumber: parsePlateNumber(item.licensePlateNumber),
      licensePlateBarcode: parsePlateNumber(item.licensePlateNumber),
      qrValue: encodeScanPayload({
        sku: item.sku,
        upc: item.upc,
        batch: item.batch,
        licensePlateNumber: item.licensePlateNumber,
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
        ...plateFields(item.licensePlateNumber),
        { label: "Item", value: item.description },
      ],
    })),
  );
}

export function buildLocationLabels(
  locations: Array<Location & { roomName: string }>,
): WarehouseLabel[] {
  return locations.map((location) => {
    const bin = parseBinCode(location.code);
    return {
      id: location.id,
      kind: "location" as const,
      heading: "Location",
      title: location.code,
      barcodeValue: location.code,
      qrValue: encodeLocationPayload({
        code: location.code,
        room: location.roomName,
        bin,
      }),
      fields: [
        { label: "Room", value: location.roomName },
        { label: "Code", value: location.code },
        ...(bin
          ? [
              { label: "Site", value: bin.codename },
              { label: "Building", value: String(bin.building).padStart(3, "0") },
              { label: "Zone", value: bin.zone },
              { label: "Aisle", value: String(bin.aisle).padStart(2, "0") },
              { label: "Bay", value: String(bin.bay).padStart(2, "0") },
            ]
          : []),
        { label: "Status", value: location.isActive ? "Active" : "Inactive" },
        { label: "Notes", value: location.description || "—" },
      ],
    };
  });
}

export function buildHandlingLabel(input: {
  id: string;
  kind: "trailer" | "license-plate" | "container";
  code: string;
  detail?: string;
}): WarehouseLabel {
  const heading =
    input.kind === "trailer"
      ? "Trailer"
      : input.kind === "license-plate"
        ? "License plate"
        : "Container";
  const plateNumber =
    input.kind === "license-plate" ? parsePlateNumber(input.code) : null;
  return {
    id: input.id,
    kind: "location",
    heading,
    title: plateNumber ?? input.code,
    barcodeValue: plateNumber ?? input.code,
    licensePlateNumber: plateNumber,
    licensePlateBarcode: plateNumber,
    qrValue: encodeHandlingPayload({ kind: input.kind, code: input.code }),
    fields: [
      { label: heading, value: plateNumber ?? input.code },
      { label: "Detail", value: input.detail || "—" },
    ],
  };
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

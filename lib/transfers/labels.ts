import type { FacilityTransfer } from "@/lib/inventory-schema";
import type { WarehouseLabel } from "@/lib/labels/build-labels";
import { parsePlateNumber } from "@/lib/license-plate/sequence";
import { encodeScanPayload } from "@/lib/scan-code";

function plateNumber(value: string | null | undefined): string | null {
  return parsePlateNumber(value);
}

function itemFields(input: {
  upc?: string;
  quantity: number;
  batch?: string | null;
  manufacturer?: string;
  color?: string | null;
  description: string;
  licensePlateNumber: string;
}): Array<{ label: string; value: string }> {
  const plate = plateNumber(input.licensePlateNumber);
  return [
    { label: "UPC", value: input.upc || "—" },
    { label: "Qty", value: String(input.quantity) },
    { label: "Batch", value: input.batch || "—" },
    { label: "Manufacturer", value: input.manufacturer || "—" },
    { label: "Color", value: input.color || "—" },
    ...(plate ? [{ label: "License plate", value: plate }] : []),
    { label: "Item", value: input.description },
  ];
}

/** Tag printed when freight is loaded. Destination nomenclature plus the outbound facility LP. */
export function buildOutboundTransferLabels(transfer: FacilityTransfer): WarehouseLabel[] {
  return transfer.lines.map((line) => {
    const plate = plateNumber(line.outboundLicensePlateNumber);
    return {
      id: line.id,
      kind: "outbound" as const,
      heading: "Outbound transfer",
      title: line.sku,
      barcodeValue: line.upc || line.sku,
      licensePlateNumber: plate,
      licensePlateBarcode: plate,
      qrValue: encodeScanPayload({
        sku: line.sku,
        upc: line.upc,
        batch: line.batch,
        licensePlateNumber: line.outboundLicensePlateNumber,
      }),
      fields: [
        { label: "Trailer", value: transfer.trailerCode },
        { label: "Destination", value: transfer.destinationNomenclature },
        { label: "Nomenclature", value: transfer.destinationNomenclature },
        ...itemFields({
          upc: line.upc,
          quantity: line.quantityLoaded,
          batch: line.batch,
          manufacturer: line.manufacturer,
          color: line.color,
          description: line.description,
          licensePlateNumber: line.outboundLicensePlateNumber,
        }),
      ],
    };
  });
}

/** Tag printed after receipt is verified. Routing, item codes, and this facility's LP. */
export function buildInboundTransferLabels(transfer: FacilityTransfer): WarehouseLabel[] {
  return transfer.lines.flatMap((line) =>
    line.routes.map((route) => {
      const plate = plateNumber(route.licensePlateNumber);
      return {
        id: `${line.id}:${route.licensePlateNumber}`,
        kind: "inbound" as const,
        heading: "Inbound transfer",
        title: line.sku,
        barcodeValue: line.upc || line.sku,
        licensePlateNumber: plate,
        licensePlateBarcode: plate,
        qrValue: encodeScanPayload({
          sku: line.sku,
          upc: line.upc,
          batch: line.batch,
          licensePlateNumber: route.licensePlateNumber,
        }),
        fields: [
          { label: "Trailer", value: transfer.trailerCode },
          { label: "From", value: transfer.sourceNomenclature },
          { label: "Route", value: route.locationCode },
          ...itemFields({
            upc: line.upc,
            quantity: route.quantity,
            batch: line.batch,
            manufacturer: line.manufacturer,
            color: line.color,
            description: line.description,
            licensePlateNumber: route.licensePlateNumber,
          }),
        ],
      };
    }),
  );
}

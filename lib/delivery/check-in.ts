import type {
  DeliveryRecord,
  DeliveryScan,
  ShippingOrder,
} from "@/lib/inventory-schema";
import { parseScanCode } from "@/lib/scan-code";

export type DeliveryProgressStatus = "pending" | "partial" | "delivered";

export type DeliveryCaseProgress = {
  id: string;
  sku: string;
  upc: string;
  description: string;
  quantity: number;
  delivered: boolean;
};

export type DeliveryPalletProgress = {
  id: string;
  palletNumber: string;
  trackingNumber: string;
  delivered: boolean;
  cases: DeliveryCaseProgress[];
};

export type DeliveryProgress = {
  status: DeliveryProgressStatus;
  pallets: DeliveryPalletProgress[];
  deliveredPallets: number;
  totalPallets: number;
};

export class DeliveryCheckInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryCheckInError";
  }
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function scanKeys(raw: string): string[] {
  const parsed = parseScanCode(raw);
  const keys = new Set<string>();
  for (const value of [raw, parsed.sku, parsed.upc]) {
    const next = norm(value);
    if (next) keys.add(next);
  }
  return [...keys];
}

export function deliveryStatusLabel(status: DeliveryProgressStatus): string {
  if (status === "delivered") return "Delivered";
  if (status === "partial") return "Partial";
  return "On truck";
}

export function deliveryProgress(order: ShippingOrder): DeliveryProgress {
  const scans = order.delivery?.scans ?? [];
  const palletScanned = new Set(
    scans.filter((scan) => scan.match === "pallet").map((scan) => scan.palletId),
  );
  const caseScanned = new Set(
    scans.filter((scan) => scan.match === "case").map((scan) => scan.matchedId),
  );
  const pallets = order.pallets.map((pallet) => {
    const palletChecked = palletScanned.has(pallet.id);
    const cases = pallet.cases.map((item) => ({
      id: item.id,
      sku: item.sku,
      upc: item.upc,
      description: item.description,
      quantity: item.quantityInCase,
      delivered: palletChecked || caseScanned.has(item.id),
    }));
    const delivered =
      palletChecked || (cases.length > 0 && cases.every((item) => item.delivered));
    return {
      id: pallet.id,
      palletNumber: pallet.palletNumber,
      trackingNumber: pallet.trackingNumber ?? "",
      delivered,
      cases,
    };
  });
  const deliveredPallets = pallets.filter((pallet) => pallet.delivered).length;
  const anyChecked = pallets.some(
    (pallet) => pallet.delivered || pallet.cases.some((item) => item.delivered),
  );
  const status: DeliveryProgressStatus =
    pallets.length === 0 || !anyChecked
      ? "pending"
      : deliveredPallets === pallets.length
        ? "delivered"
        : "partial";
  return {
    status,
    pallets,
    deliveredPallets,
    totalPallets: pallets.length,
  };
}

export function formatScanLocation(scan: DeliveryScan): string {
  if (scan.latitude == null || scan.longitude == null) {
    return "Location unavailable";
  }
  const accuracy =
    scan.accuracyMeters != null
      ? ` ±${Math.round(scan.accuracyMeters)} m`
      : "";
  return `${scan.latitude.toFixed(5)}, ${scan.longitude.toFixed(5)}${accuracy}`;
}

function geoFields(input: {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
}): Pick<DeliveryScan, "latitude" | "longitude" | "accuracyMeters"> {
  const latitude = input.latitude;
  const longitude = input.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return { latitude: null, longitude: null, accuracyMeters: null };
  }
  const accuracy = input.accuracyMeters;
  return {
    latitude,
    longitude,
    accuracyMeters:
      typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
  };
}

export function applyDeliveryScan(
  order: ShippingOrder,
  input: {
    id: string;
    code: string;
    scannedAt: string;
    scannedBy?: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
  },
): DeliveryRecord {
  if (order.status === "cancelled") {
    throw new DeliveryCheckInError("Cancelled shipments cannot be checked in.");
  }
  const progress = deliveryProgress(order);
  if (progress.totalPallets === 0) {
    throw new DeliveryCheckInError("This load has no pallets or cases to check in.");
  }
  const keys = scanKeys(input.code);
  if (keys.length === 0) {
    throw new DeliveryCheckInError("Scan a pallet or case label.");
  }

  const pallet = progress.pallets.find((entry) => {
    const palletNumber = norm(entry.palletNumber);
    const tracking = norm(entry.trackingNumber);
    return (
      keys.includes(palletNumber) ||
      keys.includes(norm(entry.id)) ||
      (tracking.length > 0 && keys.includes(tracking))
    );
  });

  let scan: DeliveryScan;
  if (pallet) {
    if (pallet.delivered) {
      throw new DeliveryCheckInError("That pallet is already checked in.");
    }
    scan = {
      id: input.id,
      code: input.code.trim(),
      match: "pallet",
      matchedId: pallet.id,
      palletId: pallet.id,
      label: pallet.palletNumber,
      scannedAt: input.scannedAt,
      scannedBy: input.scannedBy,
      ...geoFields(input),
    };
  } else {
    const candidates = progress.pallets.flatMap((entry) =>
      entry.cases
        .filter((item) => {
          const sku = norm(item.sku);
          const upc = norm(item.upc);
          return (
            keys.includes(norm(item.id)) ||
            (sku.length > 0 && keys.includes(sku)) ||
            (upc.length > 0 && keys.includes(upc))
          );
        })
        .map((item) => ({ pallet: entry, item })),
    );
    const open = candidates.find((entry) => !entry.item.delivered);
    if (!open) {
      if (candidates.length > 0) {
        throw new DeliveryCheckInError("That case is already checked in.");
      }
      throw new DeliveryCheckInError("That label is not on this load.");
    }
    scan = {
      id: input.id,
      code: input.code.trim(),
      match: "case",
      matchedId: open.item.id,
      palletId: open.pallet.id,
      label: open.item.sku || open.item.upc,
      scannedAt: input.scannedAt,
      scannedBy: input.scannedBy,
      ...geoFields(input),
    };
  }

  const scans = [...(order.delivery?.scans ?? []), scan];
  const nextProgress = deliveryProgress({
    ...order,
    delivery: { ...(order.delivery ?? {}), scans },
  });
  return {
    notes: order.delivery?.notes,
    updatedAt: input.scannedAt,
    updatedBy: input.scannedBy,
    deliveredAt:
      nextProgress.status === "delivered"
        ? (order.delivery?.deliveredAt ?? input.scannedAt)
        : (order.delivery?.deliveredAt ?? null),
    scans,
  };
}

export function applyDeliveryNotes(
  order: ShippingOrder,
  notes: string | undefined,
  updatedAt: string,
  updatedBy?: string,
): DeliveryRecord {
  if (order.status === "cancelled") {
    throw new DeliveryCheckInError(
      "Notes cannot be added to a cancelled shipment.",
    );
  }
  return {
    notes,
    scans: order.delivery?.scans ?? [],
    deliveredAt: order.delivery?.deliveredAt ?? null,
    updatedAt,
    updatedBy,
  };
}

import type { PhotoOwnerType } from "@/lib/inventory-schema";
import type { Permission } from "@/lib/auth/permissions";

export type PhotoOwnerLookup = {
  receivingOrders: Array<{ id: string; status: string }>;
  shippingOrders: Array<{ id: string; status: string }>;
  transactions: Array<{
    referenceType?: string;
    referenceId?: string;
  }>;
};

export type PhotoOwnerResult =
  | { ok: true; cancelled: false }
  | { ok: false; error: string };

export function permissionForPhotoWrite(ownerType: PhotoOwnerType): Permission {
  if (ownerType === "receiving-order") return "receive";
  if (ownerType === "shipping-order") return "ship";
  return "adjustInventory";
}

export function resolvePhotoOwner(
  system: PhotoOwnerLookup,
  ownerType: PhotoOwnerType,
  ownerId: string,
): PhotoOwnerResult {
  if (ownerType === "receiving-order") {
    const order = system.receivingOrders.find((entry) => entry.id === ownerId);
    if (!order) {
      return { ok: false, error: "Receiving order was not found." };
    }
    if (order.status === "cancelled") {
      return {
        ok: false,
        error: "Photos cannot be added to a cancelled receiving order.",
      };
    }
    return { ok: true, cancelled: false };
  }

  if (ownerType === "shipping-order") {
    const order = system.shippingOrders.find((entry) => entry.id === ownerId);
    if (!order) {
      return { ok: false, error: "Shipment was not found." };
    }
    if (order.status === "cancelled") {
      return {
        ok: false,
        error: "Photos cannot be added to a cancelled shipment.",
      };
    }
    return { ok: true, cancelled: false };
  }

  const match = system.transactions.some(
    (entry) =>
      entry.referenceType === "adjustment" && entry.referenceId === ownerId,
  );
  if (!match) {
    return { ok: false, error: "Damage / adjustment record was not found." };
  }
  return { ok: true, cancelled: false };
}

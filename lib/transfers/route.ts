import { ValidationError } from "@/lib/validation/errors";

export type TransferRouteSlot = {
  locationId: string;
  locationCode: string;
  openUnits: number;
};

export type TransferRouteSlice = {
  locationId: string;
  locationCode: string;
  quantity: number;
};

/**
 * Fill destination locations in the order given.
 * Every slice is a positive whole number, none exceeds the slot, and the
 * slices add back to the verified receipt.
 */
export function routeTransferQuantity(
  quantity: number,
  slots: readonly TransferRouteSlot[],
): TransferRouteSlice[] {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ValidationError("Receipt quantity must be a positive whole number.");
  }

  let remaining = quantity;
  const slices: TransferRouteSlice[] = [];
  for (const slot of slots) {
    if (remaining === 0) break;
    if (!Number.isInteger(slot.openUnits) || slot.openUnits < 1) continue;
    const take = Math.min(remaining, slot.openUnits);
    slices.push({
      locationId: slot.locationId,
      locationCode: slot.locationCode,
      quantity: take,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new ValidationError(
      `No active location at this facility can hold the remaining ${remaining} units.`,
    );
  }

  const routed = slices.reduce((sum, slice) => sum + slice.quantity, 0);
  if (routed !== quantity || slices.some((slice) => slice.quantity < 1)) {
    throw new ValidationError("Routed quantity does not match the verified receipt.");
  }
  for (const slice of slices) {
    const slot = slots.find((entry) => entry.locationId === slice.locationId);
    if (!slot || slice.quantity > slot.openUnits) {
      throw new ValidationError("Routed quantity does not match the verified receipt.");
    }
  }
  return slices;
}

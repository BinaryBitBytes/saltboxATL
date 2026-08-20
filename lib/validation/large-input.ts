import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export type LargeInputConfirmationInput = {
  confirmLargeInput?: boolean;
  confirmationQuantity?: number;
};

export function isLargeQuantity(
  total: number,
  threshold: number = LIMITS.largeQuantity,
): boolean {
  return total >= threshold;
}

export function assertLargeInputConfirmed(
  total: number,
  confirmation: LargeInputConfirmationInput | undefined,
  threshold: number = LIMITS.largeQuantity,
  label = "quantity",
): void {
  if (!Number.isFinite(total) || total < threshold) {
    return;
  }

  if (!confirmation?.confirmLargeInput) {
    throw new ValidationError(
      `This ${label} of ${total} is large (threshold ${threshold}). Check the confirmation box and re-enter the amount to continue.`,
      400,
      "LARGE_INPUT_CONFIRMATION_REQUIRED",
    );
  }

  if (confirmation.confirmationQuantity !== total) {
    throw new ValidationError(
      `Confirmation ${label} must exactly match ${total}.`,
      400,
      "LARGE_INPUT_CONFIRMATION_MISMATCH",
    );
  }
}

export function largeInputPayload(
  total: number,
  confirmed: boolean,
  confirmationQuantity: number | "",
  threshold: number = LIMITS.largeQuantity,
): LargeInputConfirmationInput {
  if (!isLargeQuantity(total, threshold)) {
    return {};
  }
  return {
    confirmLargeInput: confirmed,
    confirmationQuantity:
      confirmationQuantity === "" ? undefined : confirmationQuantity,
  };
}

export function sumQuantities(values: Array<{ quantity?: number } | number>): number {
  return values.reduce<number>((total, value) => {
    const quantity = typeof value === "number" ? value : (value.quantity ?? 0);
    return total + quantity;
  }, 0);
}

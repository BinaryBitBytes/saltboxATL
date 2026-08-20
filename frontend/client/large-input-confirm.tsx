"use client";

import { LIMITS } from "@/lib/validation/limits";
import { isLargeQuantity } from "@/lib/validation/large-input";
import { Field } from "@/frontend/client/field";
import { Input } from "@/components/ui/input";

export function LargeInputConfirm({
  total,
  threshold = LIMITS.largeQuantity,
  label = "quantity",
  confirmed,
  onConfirmedChange,
  confirmationQuantity,
  onConfirmationQuantityChange,
}: {
  total: number;
  threshold?: number;
  label?: string;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  confirmationQuantity: number | "";
  onConfirmationQuantityChange: (value: number | "") => void;
}) {
  if (!isLargeQuantity(total, threshold)) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        This {label} of {total} is at or above the confirmation threshold (
        {threshold}). Check the box and re-enter the amount to continue.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
        />
        I confirm this {label} is {total}
      </label>
      <Field label={`Re-enter ${label}`} htmlFor="confirmationQuantity">
        <Input
          id="confirmationQuantity"
          type="number"
          min={threshold}
          value={confirmationQuantity}
          onChange={(event) => {
            const value = event.target.value;
            onConfirmationQuantityChange(value === "" ? "" : Number(value));
          }}
        />
      </Field>
    </div>
  );
}

export { largeInputPayload } from "@/lib/validation/large-input";

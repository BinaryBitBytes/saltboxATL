"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelCustomerOrder,
  completeCustomerOrderPick,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";

export function OrderActions({
  orderId,
  canCancel,
  canFulfill,
}: {
  orderId: string;
  canCancel: boolean;
  canFulfill: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canCancel && !canFulfill) return null;

  return (
    <div className="grid gap-2 print:hidden">
      <div className="flex flex-wrap gap-2">
        {canFulfill ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await completeCustomerOrderPick(orderId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            {pending ? "Saving…" : "Complete pick"}
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await cancelCustomerOrder(orderId);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            Cancel order
          </Button>
        ) : null}
      </div>
      {canFulfill ? (
        <p className="text-xs text-muted-foreground">
          Completing the pick removes the ordered quantity from on-hand inventory.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

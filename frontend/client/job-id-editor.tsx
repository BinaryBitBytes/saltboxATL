"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPurchaseOrderJobId } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/lib/validation/limits";

export function JobIdEditor({
  purchaseOrderNumber,
  jobIdNumber,
}: {
  purchaseOrderNumber: string;
  jobIdNumber: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(jobIdNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setPurchaseOrderJobId({
        purchaseOrderNumber,
        jobIdNumber: value,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">Job ID</p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          maxLength={LIMITS.code}
          placeholder="Optional"
          aria-label={`Job ID for PO ${purchaseOrderNumber}`}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
        />
        <Button type="button" variant="outline" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[0.625rem] text-muted-foreground">
        Optional internal tracking number for this purchase order.
      </p>
      {saved ? (
        <p className="text-[0.625rem] text-muted-foreground">Job ID saved.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

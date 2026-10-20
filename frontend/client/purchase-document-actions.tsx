"use client";

import { T } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  importInvoiceInboundLoad,
  redactInvoicePrices,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import { LIMITS } from "@/lib/validation/limits";
import type { PurchaseDocumentView } from "@/lib/documents/view";

export function PurchaseDocumentActions({
  document,
}: {
  document: PurchaseDocumentView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">("");
  const expectedUnits = document.lines.reduce((sum, line) => sum + line.quantity, 0);
  const showPrices = document.lines.some(
    (line) => line.unitPrice || line.extendedPrice,
  );

  function redact() {
    setError(null);
    startTransition(async () => {
      const result = await redactInvoicePrices(document.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function importLoad() {
    setError(null);
    startTransition(async () => {
      const result = await importInvoiceInboundLoad(document.id, {
        ...largeInputPayload(
          expectedUnits,
          confirmLargeInput,
          confirmationQuantity,
          LIMITS.largeQuantity,
        ),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {document.kind === "invoice" ? <T>Invoice PDF</T> : <T>Purchase order PDF</T>}
          {" · "}
          {document.originalName}
        </p>
        {document.canOpenFile ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`/api/purchase-documents/${document.id}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Open PDF
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            <T>PDF saved for project managers</T>
          </p>
        )}
      </div>
      {document.recognitionNote ? (
        <p className="text-xs text-muted-foreground">
          <T>{document.recognitionNote}</T>
        </p>
      ) : null}
      {document.pricesRedacted ? (
        <p className="text-xs text-muted-foreground">
          <T>Prices redacted</T>
        </p>
      ) : null}
      {document.lines.length > 0 ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {document.lines.map((line, index) => (
            <li key={`${document.id}-${index}`}>
              {line.sku || "No SKU"}
              {line.description ? ` · ${line.description}` : ""} · {line.quantity}
              {showPrices && line.unitPrice ? ` · ${line.unitPrice}` : ""}
              {showPrices && line.extendedPrice ? ` · ${line.extendedPrice}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {document.canImport ? (
        <LargeInputConfirm
          total={expectedUnits}
          label="expected quantity"
          confirmed={confirmLargeInput}
          onConfirmedChange={setConfirmLargeInput}
          confirmationQuantity={confirmationQuantity}
          onConfirmationQuantityChange={setConfirmationQuantity}
        />
      ) : null}
      {error ? (
        <p className="text-xs text-destructive">
          <T>{error}</T>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {document.canRedact ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={redact}>
            {pending ? "Redacting…" : "Redact prices"}
          </Button>
        ) : null}
        {document.canImport ? (
          <Button type="button" size="sm" disabled={pending} onClick={importLoad}>
            {pending ? "Importing…" : "Import into inbound load"}
          </Button>
        ) : null}
        {document.imported && !document.canImport ? (
          <p className="text-xs text-muted-foreground">
            <T>Imported into inbound load</T>
          </p>
        ) : null}
      </div>
    </div>
  );
}

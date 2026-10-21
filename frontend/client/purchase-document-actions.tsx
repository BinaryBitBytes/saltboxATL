"use client";

import { T, useT } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePurchaseDocument,
  importInvoiceInboundLoad,
  redactInvoicePrices,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/frontend/client/field";
import {
  LargeInputConfirm,
  largeInputPayload,
} from "@/frontend/client/large-input-confirm";
import { INBOUND_DELETE_CONFIRMATION } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import type { PurchaseDocumentView } from "@/lib/documents/view";

export function PurchaseDocumentActions({
  document,
}: {
  document: PurchaseDocumentView;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
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

  function removePdf(event: React.FormEvent) {
    event.preventDefault();
    if (confirmText !== INBOUND_DELETE_CONFIRMATION) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePurchaseDocument({
        id: document.id,
        confirmText,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleting(false);
      setConfirmText("");
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
            <T>PDF saved for managers, project managers, and coordinators</T>
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
        {document.canDelete ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirmText("");
              setDeleting(true);
            }}
          >
            Delete PDF
          </Button>
        ) : null}
        {document.imported && !document.canImport ? (
          <p className="text-xs text-muted-foreground">
            <T>Imported into inbound load</T>
          </p>
        ) : null}
      </div>
      {deleting ? (
        <form
          onSubmit={removePdf}
          className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium">
            {t("You are deleting the uploaded PDF {{name}}.", { name: document.originalName })}
          </p>
          <p className="text-sm text-muted-foreground">
            <T>
              This removes the saved PDF. The inbound entry, its expected lines, and the expected receiving load stay. Use Edit entry if those fields also came from the wrong file. This cannot be undone.
            </T>
          </p>
          <Field label="Type DELETE to confirm." htmlFor={`${document.id}-delete-pdf`}>
            <Input
              id={`${document.id}-delete-pdf`}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label={t("Type DELETE to confirm.")}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={pending || confirmText !== INBOUND_DELETE_CONFIRMATION}
            >
              {pending ? "Deleting…" : "Delete this PDF"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDeleting(false);
                setConfirmText("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

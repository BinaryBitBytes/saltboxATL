"use client";

import { T } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/frontend/client/field";

export function PurchaseDocumentUpload() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedPo, setSavedPo] = useState<string | null>(null);
  const [savedJob, setSavedJob] = useState<string | null>(null);
  const [kind, setKind] = useState<"purchase-order" | "invoice">("purchase-order");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSavedPo(null);
    setSavedJob(null);
    if (!file) {
      setError("Choose a PDF purchase order or invoice.");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("kind", kind);
    if (purchaseOrderNumber.trim()) {
      body.set("purchaseOrderNumber", purchaseOrderNumber.trim());
    }
    startTransition(async () => {
      const response = await fetch("/api/purchase-documents", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: { purchaseOrder?: { purchaseOrderNumber?: string; jobIdNumber?: string | null } };
      };
      if (!response.ok || !payload.success) {
        setError(payload.error || "The PDF could not be read.");
        return;
      }
      setSavedPo(payload.data?.purchaseOrder?.purchaseOrderNumber ?? "");
      setSavedJob(payload.data?.purchaseOrder?.jobIdNumber ?? null);
      setPurchaseOrderNumber("");
      setFile(null);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Purchase document" htmlFor="purchase-document-kind">
          <NativeSelect
            id="purchase-document-kind"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as "purchase-order" | "invoice")
            }
          >
            <option value="purchase-order">Purchase order PDF</option>
            <option value="invoice">Invoice PDF</option>
          </NativeSelect>
        </Field>
        <Field label="Buyer PO number" htmlFor="purchase-document-po">
          <Input
            id="purchase-document-po"
            value={purchaseOrderNumber}
            placeholder="PO number on the PDF, if recognition should use a different one"
            onChange={(event) => setPurchaseOrderNumber(event.target.value)}
          />
        </Field>
        <Field label="PDF file" htmlFor="purchase-document-file" className="sm:col-span-2">
          <Input
            id="purchase-document-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      {error ? (
        <p className="text-xs text-destructive">
          <T>{error}</T>
        </p>
      ) : null}
      {savedPo ? (
        <p className="text-xs text-muted-foreground">
          <T>Saved as an expected PO.</T> {savedPo}
          {savedJob ? (
            <>
              {" · "}
              <T>Job ID</T> {savedJob}
            </>
          ) : null}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Reading PDF…" : "Save PDF"}
        </Button>
      </div>
    </form>
  );
}

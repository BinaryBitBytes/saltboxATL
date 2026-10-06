"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { PrinterIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { LabelCard } from "@/frontend/client/label-sheet";
import { DocumentBarcode } from "@/frontend/client/print-document";
import { printNamedDocument } from "@/frontend/client/print";
import { acknowledgeWarehousePrints } from "@/backend/server/serverAction";
import type { WarehouseLabel } from "@/lib/labels/build-labels";
import type {
  OrderLoadingSheet,
  OrderPackSlip,
} from "@/lib/orders/documents";
import { formatDateTime } from "@/lib/format";

function SheetHeader({
  eyebrow,
  title,
  barcodeValue,
  fields,
}: {
  eyebrow: string;
  title: string;
  barcodeValue: string;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black pb-3">
      <div>
        <p className="text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
          Saltbox · {eyebrow}
        </p>
        <h2 className="mt-1 font-heading text-xl font-semibold">{title}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="uppercase tracking-wide text-neutral-600">{field.label}</dt>
              <dd>{field.value || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
      <DocumentBarcode value={barcodeValue} label={`Barcode for ${barcodeValue}`} />
    </header>
  );
}

export function OrderPackSlipSheet({ doc }: { doc: OrderPackSlip }) {
  return (
    <article className="grid gap-4 text-sm text-black">
      <SheetHeader
        eyebrow="Pack slip"
        title={doc.orderNumber}
        barcodeValue={doc.orderNumber}
        fields={[
          { label: "Customer", value: doc.customer },
          { label: "Placed by", value: doc.placedBy },
          { label: "Submitted", value: formatDateTime(doc.submittedAt) },
          { label: "Lines", value: String(doc.totalLines) },
          { label: "SKUs", value: String(doc.skuCount) },
          { label: "Units", value: String(doc.totalUnits) },
        ]}
      />
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 font-semibold">SKU</th>
            <th className="py-1 font-semibold">UPC</th>
            <th className="py-1 font-semibold">Description</th>
            <th className="py-1 font-semibold">From</th>
            <th className="py-1 text-right font-semibold">Qty</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line) => (
            <tr key={line.id} className="border-b border-neutral-300">
              <td className="py-1.5 font-medium">{line.sku}</td>
              <td className="py-1.5">{line.upc}</td>
              <td className="py-1.5">{line.description}</td>
              <td className="py-1.5">{line.locationCode}</td>
              <td className="py-1.5 text-right">{line.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {doc.notes ? <p className="text-xs">Notes: {doc.notes}</p> : null}
    </article>
  );
}

export function OrderLoadingSheetView({ doc }: { doc: OrderLoadingSheet }) {
  return (
    <article className="grid gap-4 text-sm text-black">
      <SheetHeader
        eyebrow="Loading sheet"
        title={doc.orderNumber}
        barcodeValue={doc.pickRequestNumber}
        fields={[
          { label: "Customer", value: doc.customer },
          { label: "Pick", value: doc.pickRequestNumber },
          { label: "Printer", value: doc.printerName },
          { label: "Placed by", value: doc.placedBy },
          { label: "Submitted", value: formatDateTime(doc.submittedAt) },
          { label: "Locations", value: String(doc.totals.locations) },
          { label: "Lines", value: String(doc.totals.lines) },
          { label: "Units", value: String(doc.totals.units) },
        ]}
      />
      {doc.locations.map((location) => (
        <section key={location.locationCode} className="break-inside-avoid">
          <h3 className="font-heading text-sm font-semibold">
            {location.locationCode}
            <span className="ml-2 font-sans text-xs font-normal text-neutral-600">
              {location.unitCount} unit{location.unitCount === 1 ? "" : "s"}
            </span>
          </h3>
          <table className="mt-1 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 font-semibold">SKU</th>
                <th className="py-1 font-semibold">Description</th>
                <th className="py-1 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {location.lines.map((line) => (
                <tr key={line.id} className="border-b border-neutral-300">
                  <td className="py-1.5 font-medium">{line.sku}</td>
                  <td className="py-1.5">{line.description}</td>
                  <td className="py-1.5 text-right">{line.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-xs">
        {doc.totals.locations} location{doc.totals.locations === 1 ? "" : "s"} ·{" "}
        {doc.totals.skus} SKU{doc.totals.skus === 1 ? "" : "s"} · {doc.totals.units}{" "}
        unit{doc.totals.units === 1 ? "" : "s"}
        {doc.notes ? ` · ${doc.notes}` : ""}
      </p>
    </article>
  );
}

export type OrderBatchView = {
  orderId: string;
  orderNumber: string;
  customer: string;
  pickRequestNumber: string;
  printerName: string;
  labels: WarehouseLabel[];
  packSlip: OrderPackSlip;
  loadingSheet: OrderLoadingSheet;
};

export function OrderBatchSheets({ batch }: { batch: OrderBatchView }) {
  return (
    <>
      <section className="order-batch-labels flex flex-wrap gap-3">
        {batch.labels.map((label) => (
          <LabelCard key={label.id} label={label} />
        ))}
      </section>
      <section className="order-batch-sheet mt-6 rounded-md border border-black bg-white p-4 text-black">
        <OrderPackSlipSheet doc={batch.packSlip} />
      </section>
      <section className="order-batch-sheet mt-6 rounded-md border border-black bg-white p-4 text-black">
        <OrderLoadingSheetView doc={batch.loadingSheet} />
      </section>
    </>
  );
}

export function OrderPrintBatch({
  batch,
  canReprint,
}: {
  batch: OrderBatchView;
  canReprint: boolean;
}) {
  const printId = `order-batch-${batch.orderId}`;
  return (
    <div className="grid gap-3">
      {canReprint ? (
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-sm text-muted-foreground">
            {batch.labels.length} item label{batch.labels.length === 1 ? "" : "s"}, pack slip,
            and loading sheet for {batch.printerName}.
          </p>
          <Button type="button" variant="outline" onClick={() => printNamedDocument(printId)}>
            <HugeiconsIcon icon={PrinterIcon} strokeWidth={2} />
            Reprint batch
          </Button>
        </div>
      ) : null}
      <div
        data-print-root={printId}
        data-print-layout="batch"
        className="grid gap-4 rounded-lg border border-border bg-muted/30 p-3 print:border-0 print:bg-white print:p-0"
      >
        <OrderBatchSheets batch={batch} />
      </div>
    </div>
  );
}

export function WarehousePrinterQueue({
  printerName,
  jobs,
}: {
  printerName: string;
  jobs: OrderBatchView[];
}) {
  const router = useRouter();
  const queueKey = jobs.map((job) => job.orderId).join(",");

  useEffect(() => {
    if (!queueKey) return;
    let cancelled = false;
    const orderIds = queueKey.split(",");
    const acknowledge = () => {
      if (cancelled) return;
      void acknowledgeWarehousePrints(orderIds).then(() => {
        router.refresh();
      });
    };
    window.addEventListener("afterprint", acknowledge);
    const timer = window.setTimeout(() => {
      if (!cancelled) printNamedDocument("warehouse-label-queue");
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", acknowledge);
    };
  }, [queueKey, router]);

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No batches are waiting on {printerName}.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-muted-foreground">
          {jobs.length} batch{jobs.length === 1 ? "" : "es"} printing to {printerName}.
        </p>
        <Button type="button" onClick={() => printNamedDocument("warehouse-label-queue")}>
          <HugeiconsIcon icon={PrinterIcon} strokeWidth={2} />
          Print queue
        </Button>
      </div>
      <div
        data-print-root="warehouse-label-queue"
        data-print-layout="batch"
        className="grid gap-8"
      >
        {jobs.map((job) => (
          <section key={job.orderId} className="grid gap-3">
            <h2 className="text-sm font-medium print:hidden">
              {job.orderNumber} · {job.customer} · pick {job.pickRequestNumber}
            </h2>
            <OrderBatchSheets batch={job} />
          </section>
        ))}
      </div>
    </div>
  );
}

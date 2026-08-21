"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PrinterIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import type { WarehouseLabel } from "@/lib/labels/build-labels";
import { printNamedDocument } from "@/frontend/client/print";
import { cn } from "@/lib/utils";

function LabelMark({
  barcodeValue,
  qrValue,
  compact = false,
}: {
  barcodeValue: string;
  qrValue: string;
  compact?: boolean;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const barcodeId = useId().replace(/:/g, "");

  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then((qrcode) =>
        qrcode.toDataURL(qrValue, {
          width: compact ? 96 : 128,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (active) setQrSrc(url);
      });
    return () => {
      active = false;
    };
  }, [compact, qrValue]);

  useEffect(() => {
    const svg = barcodeRef.current;
    if (!svg || !barcodeValue) return;
    void import("jsbarcode").then((mod) => {
      const JsBarcode = mod.default;
      JsBarcode(svg, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: compact ? 10 : 12,
        height: compact ? 28 : 40,
        margin: 0,
        width: compact ? 1.1 : 1.3,
      });
    });
  }, [barcodeValue, compact]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <svg
        ref={barcodeRef}
        id={`barcode-${barcodeId}`}
        role="img"
        aria-label={`Barcode for ${barcodeValue}`}
        className="max-w-full text-black"
      />
      {qrSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrSrc}
          alt={`QR code for ${barcodeValue}`}
          className={compact ? "size-16" : "size-20"}
        />
      ) : (
        <div className={cn("bg-muted", compact ? "size-16" : "size-20")} />
      )}
    </div>
  );
}

export function LabelCard({
  label,
  compact = false,
}: {
  label: WarehouseLabel;
  compact?: boolean;
}) {
  return (
    <article
      className={cn(
        "break-inside-avoid rounded-md border border-black bg-white p-3 text-black",
        label.kind === "location"
          ? "min-h-[1.75in] w-[2.9in]"
          : "min-h-[2.4in] w-[4in]",
      )}
    >
      <p className="text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
        {label.heading}
      </p>
      <h3 className="mt-1 font-heading text-base font-semibold leading-tight">
        {label.title}
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem]">
        {label.fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-[0.6rem] uppercase tracking-wide text-neutral-600">
              {field.label}
            </dt>
            <dd className="truncate">{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <LabelMark
          barcodeValue={label.barcodeValue}
          qrValue={label.qrValue}
          compact={compact || label.kind === "location"}
        />
      </div>
    </article>
  );
}

export function LabelPrintSheet({
  title,
  description,
  labels,
  printId = "labels",
}: {
  title: string;
  description: string;
  labels: WarehouseLabel[];
  printId?: string;
}) {
  if (labels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No labels to print yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" onClick={() => printNamedDocument(printId)}>
          <HugeiconsIcon icon={PrinterIcon} strokeWidth={2} />
          Print {labels.length} label{labels.length === 1 ? "" : "s"}
        </Button>
      </div>
      <div
        data-print-root={printId}
        data-print-layout="labels"
        className="flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-3 print:gap-2 print:border-0 print:bg-white print:p-0"
      >
        {labels.map((label) => (
          <LabelCard key={label.id} label={label} />
        ))}
      </div>
    </div>
  );
}

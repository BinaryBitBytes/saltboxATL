"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PrinterIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { printNamedDocument } from "@/frontend/client/print";

export function DocumentBarcode({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const barcodeId = useId().replace(/:/g, "");

  useEffect(() => {
    const svg = barcodeRef.current;
    if (!svg || !value) return;
    void import("jsbarcode").then((mod) => {
      mod.default(svg, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: 12,
        height: 36,
        margin: 0,
        width: 1.2,
      });
    });
  }, [value]);

  return (
    <svg
      ref={barcodeRef}
      id={`doc-barcode-${barcodeId}`}
      role="img"
      aria-label={label}
      className="max-w-full text-black"
    />
  );
}

export function PrintDocument({
  id,
  title,
  description,
  buttonLabel,
  layout = "document",
  children,
}: {
  id: string;
  title: string;
  description?: string;
  buttonLabel: string;
  layout?: "document" | "labels";
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Button type="button" onClick={() => printNamedDocument(id)}>
          <HugeiconsIcon icon={PrinterIcon} strokeWidth={2} />
          {buttonLabel}
        </Button>
      </div>
      <div
        data-print-root={id}
        data-print-layout={layout}
        className={
          layout === "labels"
            ? "flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-3 print:gap-2 print:border-0 print:bg-white print:p-0"
            : "rounded-lg border border-border bg-white p-4 text-black print:border-0 print:p-0"
        }
      >
        {children}
      </div>
    </div>
  );
}

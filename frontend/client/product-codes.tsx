"use client";

import { useEffect, useRef, useState } from "react";
import { encodeScanPayload } from "@/lib/scan-code";

export function ProductCodes({
  sku,
  upc,
  batch,
}: {
  sku: string;
  upc?: string;
  batch?: string | null;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const barcodeValue = upc || sku;
  const qrValue = encodeScanPayload({ sku, upc, batch });

  useEffect(() => {
    let active = true;
    void import("qrcode").then((qrcode) =>
      qrcode.toDataURL(qrValue, { width: 128, margin: 1, errorCorrectionLevel: "M" }),
    ).then((url) => {
      if (active) setQrSrc(url);
    });
    return () => {
      active = false;
    };
  }, [qrValue]);

  useEffect(() => {
    const svg = barcodeRef.current;
    if (!svg) return;
    void import("jsbarcode").then((mod) => {
      const JsBarcode = mod.default;
      JsBarcode(svg, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: 12,
        height: 44,
        margin: 0,
        width: 1.4,
      });
    });
  }, [barcodeValue]);

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-background p-3">
      <div className="grid gap-1">
        <p className="text-[0.625rem] text-muted-foreground">Barcode (Code 128)</p>
        <svg ref={barcodeRef} role="img" aria-label={`Barcode for ${barcodeValue}`} />
      </div>
      <div className="grid gap-1">
        <p className="text-[0.625rem] text-muted-foreground">QR (SKU / UPC)</p>
        {qrSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrSrc} alt={`QR code for ${sku}`} className="size-24" />
        ) : (
          <div className="size-24 bg-muted" />
        )}
      </div>
    </div>
  );
}

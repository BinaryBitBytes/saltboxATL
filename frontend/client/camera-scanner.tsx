"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseScanCode, type ScanPayload } from "@/lib/scan-code";

export function CameraScanner({
  onScan,
  onClose,
}: {
  onScan: (payload: ScanPayload) => void;
  onClose: () => void;
}) {
  const elementId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  }, [onClose, onScan]);

  useEffect(() => {
    let cancelled = false;
    let scanner: { stop: () => Promise<void> } | null = null;

    async function start() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
          "html5-qrcode"
        );
        if (cancelled) return;
        const instance = new Html5Qrcode(elementId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
        });
        scanner = instance;
        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 160 } },
          (text) => {
            onScanRef.current(parseScanCode(text));
            void instance.stop().catch(() => undefined);
            onCloseRef.current();
          },
          () => undefined,
        );
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Camera scanning is not available in this browser.",
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      void scanner?.stop().catch(() => undefined);
    };
  }, [elementId]);

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div id={elementId} className="min-h-32 max-h-[min(20rem,50dvh)] overflow-hidden rounded-md bg-black short:min-h-24" />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" variant="outline" onClick={onClose}>
        Close camera
      </Button>
    </div>
  );
}

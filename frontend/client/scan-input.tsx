"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { QrCodeScanIcon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CameraScanner } from "@/frontend/client/camera-scanner";
import { parseScanCode, type ScanPayload } from "@/lib/scan-code";

export function ScanInput({
  onScan,
  placeholder = "Scan barcode or QR, then press Enter",
  autoFocus = false,
}: {
  onScan: (payload: ScanPayload) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  function submitCode(raw: string) {
    const parsed = parseScanCode(raw);
    if (!parsed.raw) return;
    onScan(parsed);
    setValue("");
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitCode(value);
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={() => submitCode(value)}>
          Enter
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setCameraOpen((open) => !open)}
        >
          <HugeiconsIcon icon={QrCodeScanIcon} strokeWidth={2} />
          Camera
        </Button>
      </div>
      {cameraOpen ? (
        <CameraScanner
          onScan={(payload) => {
            onScan(payload);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}

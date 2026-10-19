"use client";

import { T } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordDeliveryScan,
  saveDeliveryNotes,
} from "@/backend/server/serverAction";
import { ScanInput } from "@/frontend/client/scan-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/frontend/client/field";
import type { ScanPayload } from "@/lib/scan-code";

type GeoReading = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
};

function capturePosition(): Promise<GeoReading | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  const reading = new Promise<GeoReading | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
  return Promise.race([
    reading,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 9000);
    }),
  ]);
}

export function DeliveryCheckIn({
  shipmentId,
  notes,
}: {
  shipmentId: string;
  notes: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState(notes);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);

  function onScan(payload: ScanPayload) {
    setError(null);
    setLocationNote("Capturing location…");
    startTransition(async () => {
      const geo = await capturePosition();
      setLocationNote(
        geo
          ? `Location captured (±${Math.round(geo.accuracyMeters ?? 0)} m). Time is stamped by the server.`
          : "Location unavailable. The scan still records the server date and time.",
      );
      const result = await recordDeliveryScan({
        shipmentId,
        code: payload.raw,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        accuracyMeters: geo?.accuracyMeters ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function saveNotes(event: React.FormEvent) {
    event.preventDefault();
    setNoteMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await saveDeliveryNotes({
        shipmentId,
        notes: noteDraft,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNoteMessage("Delivery notes saved.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-sm font-medium"><T>Scan pallet or case label</T></p>
        <ScanInput
          onScan={onScan}
          autoFocus
          placeholder="Scan the pallet or case shipping label"
        />
        {pending ? (
          <p className="text-xs text-muted-foreground"><T>Saving check-in…</T></p>
        ) : null}
        {locationNote ? (
          <p className="text-xs text-muted-foreground">{locationNote}</p>
        ) : null}
      </div>
      <form onSubmit={saveNotes} className="grid gap-2">
        <Field label="Delivery notes" htmlFor="delivery-notes">
          <Textarea
            id="delivery-notes"
            value={noteDraft}
            onChange={(event) => {
              setNoteDraft(event.target.value);
              setNoteMessage(null);
            }}
            placeholder="Access issues, shortages, or receiver comments"
          />
        </Field>
        <div>
          <Button type="submit" variant="outline" disabled={pending}><T>Save notes</T></Button>
        </div>
        {noteMessage ? (
          <p className="text-xs text-muted-foreground">{noteMessage}</p>
        ) : null}
      </form>
      {error ? <p className="text-xs text-destructive"><T>{error}</T></p> : null}
    </div>
  );
}

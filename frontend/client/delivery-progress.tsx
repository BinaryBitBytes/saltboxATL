"use client";

import { FormattedDate, T, useT } from "@/frontend/client/language";
import type { ShippingOrder } from "@/lib/inventory-schema";
import {
  deliveryProgress,
  deliveryStatusLabel,
  formatScanLocation,
} from "@/lib/delivery/check-in";
import { Badge } from "@/components/ui/badge";

export function DeliveryProgressView({ order }: { order: ShippingOrder }) {
  const t = useT();
  const progress = deliveryProgress(order);
  const scans = order.delivery?.scans ?? [];

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={progress.status === "delivered" ? "secondary" : "outline"}>
          {deliveryStatusLabel(progress.status)}
        </Badge>
        <span className="text-muted-foreground">
          {t("{{delivered}} of {{total}} pallets checked in", {
            delivered: progress.deliveredPallets,
            total: progress.totalPallets,
          })}
        </span>
      </div>
      {progress.pallets.length === 0 ? (
        <p className="text-muted-foreground"><T>This shipment has no pallets yet.</T></p>
      ) : (
        <ul className="grid gap-2">
          {progress.pallets.map((pallet) => (
            <li key={pallet.id} className="rounded-md border border-border p-3">
              <p className="font-medium">
                Pallet {pallet.palletNumber}
                {pallet.trackingNumber ? ` · ${pallet.trackingNumber}` : ""}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · <T>{pallet.delivered ? "Checked in" : "Still on the load"}</T>
                </span>
              </p>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {pallet.cases.map((item) => (
                  <li key={item.id}>
                    <T>{item.delivered ? "Delivered" : "Still open"}</T> · {item.sku} · <T>Qty</T>{" "}
                    {item.quantity}
                    {item.description ? ` · ${item.description}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {scans.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground"><T>Scan log</T></p>
          {scans.map((scan) => (
            <p key={scan.id} className="text-xs text-muted-foreground">
              <FormattedDate value={scan.scannedAt} /> · {scan.match} {scan.label} ·{" "}
              {formatScanLocation(scan)}
              {scan.scannedBy ? ` · ${scan.scannedBy}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      {order.delivery?.notes ? (
        <p>
          <span className="text-muted-foreground"><T>Driver notes:</T></span>
          {order.delivery.notes}
        </p>
      ) : null}
    </div>
  );
}

import type { ShippingOrder } from "@/lib/inventory-schema";
import {
  deliveryProgress,
  deliveryStatusLabel,
  formatScanLocation,
} from "@/lib/delivery/check-in";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function DeliveryProgressView({ order }: { order: ShippingOrder }) {
  const progress = deliveryProgress(order);
  const scans = order.delivery?.scans ?? [];

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={progress.status === "delivered" ? "secondary" : "outline"}>
          {deliveryStatusLabel(progress.status)}
        </Badge>
        <span className="text-muted-foreground">
          {progress.deliveredPallets} of {progress.totalPallets} pallets checked in
        </span>
      </div>
      {progress.pallets.length === 0 ? (
        <p className="text-muted-foreground">This shipment has no pallets yet.</p>
      ) : (
        <ul className="grid gap-2">
          {progress.pallets.map((pallet) => (
            <li key={pallet.id} className="rounded-md border border-border p-3">
              <p className="font-medium">
                Pallet {pallet.palletNumber}
                {pallet.trackingNumber ? ` · ${pallet.trackingNumber}` : ""}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {pallet.delivered ? "Checked in" : "Still on the load"}
                </span>
              </p>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {pallet.cases.map((item) => (
                  <li key={item.id}>
                    {item.delivered ? "Delivered" : "Open"} · {item.sku} · qty{" "}
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
          <p className="text-xs font-medium text-muted-foreground">Scan log</p>
          {scans.map((scan) => (
            <p key={scan.id} className="text-xs text-muted-foreground">
              {formatDateTime(scan.scannedAt)} · {scan.match} {scan.label} ·{" "}
              {formatScanLocation(scan)}
              {scan.scannedBy ? ` · ${scan.scannedBy}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      {order.delivery?.notes ? (
        <p>
          <span className="text-muted-foreground">Driver notes: </span>
          {order.delivery.notes}
        </p>
      ) : null}
    </div>
  );
}

import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { deliveryProgress, deliveryStatusLabel } from "@/lib/delivery/check-in";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoadsPage() {
  await requirePermission("viewDriverLoad");
  const system = await getSystem();
  const loads = system.shippingOrders
    .filter((order) => order.status !== "cancelled")
    .map((order) => ({ order, progress: deliveryProgress(order) }))
    .sort((left, right) => {
      const rank = (status: string) => (status === "delivered" ? 1 : 0);
      const byStatus =
        rank(left.progress.status) - rank(right.progress.status);
      if (byStatus !== 0) return byStatus;
      return right.order.shippedAt.localeCompare(left.order.shippedAt);
    });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">My loads</h1>
        <p className="text-sm text-muted-foreground">
          Open a shipment to read the manifest and pack list, scan pallet or
          case labels as delivered, and add proof photos or notes.
        </p>
      </div>
      {loads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active loads.</p>
      ) : (
        <div className="grid gap-3">
          {loads.map(({ order, progress }) => (
            <Card key={order.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{order.shipmentNumber}</CardTitle>
                    <CardDescription>
                      {order.customer} · {order.carrierOutbound} ·{" "}
                      {formatDateTime(order.shippedAt)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {deliveryStatusLabel(progress.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  {progress.deliveredPallets} of {progress.totalPallets} pallets
                  checked in
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/loads/${order.id}`} />}
                >
                  Open load
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

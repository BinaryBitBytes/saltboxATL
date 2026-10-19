import { FormattedDate, T } from "@/frontend/client/language";
import { getTranslator } from "@/lib/i18n/server";
import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { deliveryProgress, deliveryStatusLabel } from "@/lib/delivery/check-in";

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
  const { t } = await getTranslator();
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
        <h1 className="font-heading text-xl font-semibold"><T>My loads</T></h1>
        <p className="text-sm text-muted-foreground"><T>Open a shipment to read the manifest and pack list, scan pallet or case labels as delivered, and add proof photos or notes.</T></p>
      </div>
      {loads.length === 0 ? (
        <p className="text-sm text-muted-foreground"><T>No active loads.</T></p>
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
                      <FormattedDate value={order.shippedAt} />
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {deliveryStatusLabel(progress.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">
                  {t("{{delivered}} of {{total}} pallets checked in", {
                    delivered: progress.deliveredPallets,
                    total: progress.totalPallets,
                  })}
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

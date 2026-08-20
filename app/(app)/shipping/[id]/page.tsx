import { notFound } from "next/navigation";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { ShippingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ShippingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("ship");
  const { id } = await params;
  const system = await getSystem();
  const order = system.shippingOrders.find((entry) => entry.id === id);
  if (!order) notFound();

  const locations = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Shipment {order.shipmentNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.customer} · {order.carrierOutbound} ·{" "}
            {formatDateTime(order.shippedAt)}
          </p>
        </div>
        <ShippingStatusBadge status={order.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shipment header</CardTitle>
          <CardDescription>Associate {order.shipperName}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {order.pallets.map((pallet) => (
            <div key={pallet.id} className="rounded-md border border-border p-3">
              <p className="font-medium">Pallet {pallet.palletNumber}</p>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {pallet.cases.map((item) => (
                  <li key={item.id}>
                    {item.sku} · qty {item.quantityInCase}
                    {item.putawayLocationId
                      ? ` · from ${locations.get(item.putawayLocationId) ?? item.putawayLocationId}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

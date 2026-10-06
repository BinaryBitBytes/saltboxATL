import { notFound } from "next/navigation";
import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { PutawayWorkspace } from "@/frontend/client/putaway-workspace";
import { ReceivingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import { formatJobId, jobIdForPurchaseOrder } from "@/lib/purchase-orders";
import { buildCubingLocations } from "@/lib/cubing/capacity";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function PutawayOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("putaway");
  const { id } = await params;
  const system = await getSystem();
  const order = system.receivingOrders.find((entry) => entry.id === id);
  if (!order) notFound();
  const jobIdNumber = jobIdForPurchaseOrder(system.purchaseOrders, order.poNumber);

  const cases = order.pallets.flatMap((pallet) => pallet.cases);
  const units = cases.reduce((sum, item) => sum + item.quantityInCase, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Putaway {order.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.vendor} · received {formatDateTime(order.receivedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReceivingStatusBadge
            status={order.status}
            isPartialed={order.isPartialed}
          />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/receiving/${order.id}`} />}
          >
            View receiving
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staged receipt</CardTitle>
          <CardDescription>
            PO {order.poNumber}
            {jobIdNumber ? ` · Job ${jobIdNumber}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Job ID" value={formatJobId(jobIdNumber)} />
          <Detail label="Receiver" value={order.receiverName} />
          <Detail label="Cases" value={String(cases.length)} />
          <Detail label="Units" value={String(units)} />
          <Detail label="Notes" value={order.notes || "—"} />
        </CardContent>
      </Card>

      <PutawayWorkspace
        order={order}
        rooms={system.rooms}
        locations={system.locations}
        cubes={system.itemCubes}
        cubingLocations={buildCubingLocations({
          locations: system.locations,
          items: system.inventoryItems,
          orders: system.receivingOrders,
          cubes: system.itemCubes,
        })}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

import { notFound } from "next/navigation";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { ReceivingWorkspace } from "@/frontend/client/receiving-workspace";
import { ReceivingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReceivingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("receive");
  const { id } = await params;
  const system = await getSystem();
  const order = system.receivingOrders.find((entry) => entry.id === id);
  if (!order) notFound();

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Receiving {order.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.vendor} · carrier {order.carrierInbound} · received{" "}
            {formatDateTime(order.receivedAt)}
          </p>
        </div>
        <ReceivingStatusBadge status={order.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order header</CardTitle>
          <CardDescription>PO {order.poNumber}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Receiver" value={order.receiverName} />
          <Detail
            label="Expected pallets"
            value={String(order.loadPalletCount)}
          />
          <Detail
            label="Working pallet"
            value={
              order.pallets.find((pallet) => pallet.id === order.workingPalletId)
                ?.palletNumber ?? "—"
            }
          />
          <Detail label="Notes" value={order.notes || "—"} />
        </CardContent>
      </Card>

      <ReceivingWorkspace
        order={order}
        rooms={system.rooms}
        locations={system.locations}
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

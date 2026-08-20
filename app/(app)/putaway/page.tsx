import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReceivingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import { isAwaitingPutaway } from "@/lib/inventory-schema";

export default async function PutawayPage() {
  await requirePermission("putaway");
  const system = await getSystem();
  const queue = system.receivingOrders.filter((order) =>
    isAwaitingPutaway(order.status),
  );
  const recent = system.receivingOrders.filter(
    (order) => order.status === "completed",
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Putaway</h1>
        <p className="text-sm text-muted-foreground">
          Assign bin locations to received cases, then post them to on-hand
          inventory. Receiving stays a separate dock check-in.
        </p>
      </div>

      <PutawayTable
        title="Ready for putaway"
        empty="No received orders are waiting for putaway."
        orders={queue}
      />
      <PutawayTable
        title="Recently put away"
        empty="No completed putaway yet."
        orders={recent.slice(0, 12)}
      />
    </div>
  );
}

function PutawayTable({
  title,
  empty,
  orders,
}: {
  title: string;
  empty: string;
  orders: Awaited<ReturnType<typeof getSystem>>["receivingOrders"];
}) {
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Cases</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            orders.map((order) => {
              const cases = order.pallets.flatMap((pallet) => pallet.cases);
              const missing = cases.filter((item) => !item.putawayLocationId).length;
              return (
                <TableRow key={order.id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.vendor}</TableCell>
                  <TableCell>{formatDateTime(order.receivedAt)}</TableCell>
                  <TableCell>
                    {cases.length}
                    {missing > 0 ? ` · ${missing} need locations` : ""}
                  </TableCell>
                  <TableCell>
                    <ReceivingStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/putaway/${order.id}`} />}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

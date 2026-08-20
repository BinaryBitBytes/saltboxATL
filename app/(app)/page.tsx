import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { enrichInventory, enrichTransactions } from "@/backend/server/inventory-service";
import { hasPermission } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ReceivingStatusBadge,
  TransactionTypeBadge,
} from "@/frontend/client/status-badge";
import { formatDateTime, formatSignedInt, uniqueSkuCount } from "@/lib/format";

export default async function Home() {
  const user = await requireUser();
  const system = await getSystem();
  const canReceive = hasPermission(user.role, "receive");
  const canShip = hasPermission(user.role, "ship");
  const inventory = enrichInventory(system);
  const transactions = enrichTransactions(system);
  const openReceiving = system.receivingOrders.filter(
    (order) => order.status === "draft" || order.status === "in-progress",
  );
  const unitsOnHand = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const adjustments = transactions.filter((entry) =>
    entry.type === "overage" ||
    entry.type === "shortage" ||
    entry.type === "damage",
  ).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Receive inbound pallets, put away cases, and ship from on-hand stock.
          </p>
        </div>
        {canReceive || canShip ? (
          <div className="flex gap-2">
            {canReceive ? (
              <Button nativeButton={false} render={<Link href="/receiving" />}>
                New receiving
              </Button>
            ) : null}
            {canShip ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/shipping" />}
              >
                New shipment
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Units on hand" value={unitsOnHand} />
        <StatCard label="Unique SKUs" value={uniqueSkuCount(inventory)} />
        <StatCard label="Open receiving" value={openReceiving.length} />
        <StatCard
          label="Active locations"
          value={system.locations.filter((location) => location.isActive).length}
        />
        <StatCard label="Adjustments posted" value={adjustments} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open receiving</CardTitle>
            <CardDescription>Inbound orders still being worked</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {openReceiving.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open receiving orders.
              </p>
            ) : (
              openReceiving.slice(0, 6).map((order) => (
                <Link
                  key={order.id}
                  href={`/receiving/${order.id}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span>
                    {order.orderNumber} · {order.vendor}
                  </span>
                  <ReceivingStatusBadge status={order.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>On-hand snapshot</CardTitle>
            <CardDescription>Highest quantities first</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {inventory.length === 0 ? (
              <p className="text-muted-foreground">
                Inventory is empty until a receiving order is completed.
              </p>
            ) : (
              [...inventory]
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 6)
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span>
                      {item.sku}
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.locationCode}
                      </span>
                    </span>
                    <span>{item.quantity}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recent transactions</CardTitle>
            <CardDescription>Receiving, shipping, and adjustments</CardDescription>
          </div>
          <Button nativeButton={false} variant="ghost" render={<Link href="/transactions" />}>
            View log
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {transactions.length === 0 ? (
            <p className="text-muted-foreground">
              No stock movements yet. Complete receiving or post an adjustment.
            </p>
          ) : (
            transactions.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 truncate">
                  {entry.sku}
                  <span className="text-muted-foreground">
                    {" "}
                    · {entry.locationCode} · {formatDateTime(entry.occurredAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span>{formatSignedInt(entry.quantityDelta)}</span>
                  <TransactionTypeBadge type={entry.type} />
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

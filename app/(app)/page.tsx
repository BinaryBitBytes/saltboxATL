import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { resolveActiveDivision } from "@/backend/server/division";
import { divisionLabel } from "@/lib/divisions";
import { enrichInventory, enrichTransactions } from "@/backend/server/inventory-service";
import { hasPermission } from "@/lib/auth/permissions";
import { deliveryProgress, deliveryStatusLabel } from "@/lib/delivery/check-in";
import { buildInboundForecast } from "@/lib/inbound/forecast";
import { isAwaitingPutaway } from "@/lib/inventory-schema";
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
import { emptyActiveLocations } from "@/lib/locations/availability";

export default async function Home() {
  const user = await requireUser();
  const division = await resolveActiveDivision();
  const system = await getSystem();
  const canReceive = hasPermission(user.role, "receive");
  const canPutaway = hasPermission(user.role, "putaway");
  const canShip = hasPermission(user.role, "ship");
  const canPlaceOrder = hasPermission(user.role, "placeOrder");
  const canViewInventory = hasPermission(user.role, "viewInventory");
  const canViewTransactions = hasPermission(user.role, "viewTransactions");
  const canManageLocations = hasPermission(user.role, "manageLocations");
  const canForecast = hasPermission(user.role, "viewInboundForecast");
  const canUploadBuyer = hasPermission(user.role, "uploadBuyerOrders");
  const canAssignJob = hasPermission(user.role, "assignJobId");
  const canDrive = hasPermission(user.role, "viewDriverLoad");
  const inventory = canViewInventory ? enrichInventory(system) : [];
  const transactions = canViewTransactions ? enrichTransactions(system) : [];
  const openReceiving = system.receivingOrders.filter(
    (order) => order.status === "draft" || order.status === "in-progress",
  );
  const awaitingPutaway = system.receivingOrders.filter((order) =>
    isAwaitingPutaway(order.status),
  );
  const unitsOnHand = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const activeLocations = system.locations.filter((location) => location.isActive);
  const availableLocations = canViewInventory
    ? emptyActiveLocations(system.locations, system.rooms, system.inventoryItems)
    : [];
  const openPicks = (system.customerOrders ?? []).filter(
    (order) => order.pickRequest.status === "open",
  ).length;
  const adjustments = transactions.filter((entry) =>
    entry.type === "overage" ||
    entry.type === "shortage" ||
    entry.type === "damage",
  ).length;
  const forecast = canForecast
    ? buildInboundForecast(system.purchaseOrders, system.receivingOrders)
    : null;
  const loads = canDrive
    ? system.shippingOrders
        .filter((order) => order.status !== "cancelled")
        .map((order) => ({ order, progress: deliveryProgress(order) }))
    : [];

  const subtitle = canReceive
    ? "Receive inbound pallets, put away staged cases, place remote orders, and ship from on-hand stock."
    : canUploadBuyer
      ? "Upload buyer purchase orders so the dock knows the carrier, vendor, and lines to expect."
      : canAssignJob
        ? "Review on-hand inventory and assign job IDs to buyer purchase orders."
        : canDrive
          ? "Open your load, review the manifest and pack list, and check freight in as delivered."
          : "On-hand inventory and the stock log for your account.";

  return (
    <div className="grid gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-semibold sm:text-xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {divisionLabel(division)}. {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUploadBuyer ? (
            <Button nativeButton={false} render={<Link href="/inbound" />}>
              Upload buyer PO
            </Button>
          ) : null}
          {canAssignJob ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/inbound" />}
            >
              Assign job IDs
            </Button>
          ) : null}
          {canDrive ? (
            <Button nativeButton={false} render={<Link href="/loads" />}>
              My loads
            </Button>
          ) : null}
          {canReceive ? (
            <Button nativeButton={false} render={<Link href="/receiving" />}>
              New receiving
            </Button>
          ) : null}
          {canPutaway ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/putaway" />}
            >
              Putaway
            </Button>
          ) : null}
          {canPlaceOrder ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/orders" />}
            >
              Place order
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
          {canViewInventory ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/reports" />}
            >
              Item report
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 min-[30rem]:grid-cols-3 md:grid-cols-4 xl:grid-cols-8">
        {canViewInventory ? (
          <>
            <StatCard label="Units on hand" value={unitsOnHand} />
            <StatCard label="Unique SKUs" value={uniqueSkuCount(inventory)} />
          </>
        ) : null}
        {canPlaceOrder || canShip ? (
          <StatCard label="Open picks" value={openPicks} />
        ) : null}
        {canReceive ? (
          <StatCard label="Open receiving" value={openReceiving.length} />
        ) : null}
        {canPutaway ? (
          <StatCard label="Awaiting putaway" value={awaitingPutaway.length} />
        ) : null}
        {canManageLocations ? (
          <>
            <StatCard label="Active locations" value={activeLocations.length} />
            <StatCard label="Empty locations" value={availableLocations.length} />
          </>
        ) : null}
        {canViewTransactions ? (
          <StatCard label="Adjustments posted" value={adjustments} />
        ) : null}
        {forecast ? (
          <>
            <StatCard label="Upcoming POs" value={forecast.upcomingCount} />
            <StatCard label="Expected units" value={forecast.upcomingUnits} />
            {canAssignJob ? (
              <StatCard label="Awaiting job ID" value={forecast.awaitingJobId} />
            ) : null}
          </>
        ) : null}
        {canDrive ? (
          <StatCard
            label="Open loads"
            value={loads.filter((load) => load.progress.status !== "delivered").length}
          />
        ) : null}
      </div>

      {forecast ? (
        <Card>
          <CardHeader>
            <CardTitle>Expected inbound</CardTitle>
            <CardDescription>
              Buyer POs still on the way, grouped for the dock
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {forecast.rows.filter((row) =>
              row.derivedStatus === "expected" ||
              row.derivedStatus === "in-transit" ||
              row.derivedStatus === "receiving",
            ).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No upcoming buyer purchase orders.
              </p>
            ) : (
              forecast.rows
                .filter((row) =>
                  row.derivedStatus === "expected" ||
                  row.derivedStatus === "in-transit" ||
                  row.derivedStatus === "receiving",
                )
                .slice(0, 6)
                .map((row) => (
                  <Link
                    key={row.id}
                    href="/inbound"
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate">
                      PO {row.purchaseOrderNumber} · {row.carrier} · {row.vendor}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {row.expectedUnits} units
                    </span>
                  </Link>
                ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {canDrive ? (
        <Card>
          <CardHeader>
            <CardTitle>Loads</CardTitle>
            <CardDescription>Manifests waiting for delivery check-in</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {loads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active loads.</p>
            ) : (
              loads.slice(0, 6).map(({ order, progress }) => (
                <Link
                  key={order.id}
                  href={`/loads/${order.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0 truncate">
                    {order.shipmentNumber} · {order.customer}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {deliveryStatusLabel(progress.status)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {canReceive || canPutaway ? (
        <div className="grid gap-4 sm:gap-6 min-[56rem]:grid-cols-2">
          {canReceive ? (
            <Card>
              <CardHeader>
                <CardTitle>Open receiving</CardTitle>
                <CardDescription>Inbound orders still being checked in</CardDescription>
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
                      <ReceivingStatusBadge
                        status={order.status}
                        isPartialed={order.isPartialed}
                      />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          {canPutaway ? (
            <Card>
              <CardHeader>
                <CardTitle>Awaiting putaway</CardTitle>
                <CardDescription>Received cases waiting for a bin</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {awaitingPutaway.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No orders are waiting for putaway.
                  </p>
                ) : (
                  awaitingPutaway.slice(0, 6).map((order) => (
                    <Link
                      key={order.id}
                      href={`/putaway/${order.id}`}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <span>
                        {order.orderNumber} · {order.vendor}
                      </span>
                      <ReceivingStatusBadge
                        status={order.status}
                        isPartialed={order.isPartialed}
                      />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {canViewInventory ? (
        <div className="grid gap-4 sm:gap-6 min-[56rem]:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>On-hand snapshot</CardTitle>
              <CardDescription>Highest quantities first</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {inventory.length === 0 ? (
                <p className="text-muted-foreground">
                  Inventory is empty until putaway is completed.
                </p>
              ) : (
                [...inventory]
                  .sort((a, b) => b.quantity - a.quantity)
                  .slice(0, 6)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <span className="min-w-0 truncate">
                        {item.sku}
                        <span className="text-muted-foreground">
                          {" "}
                          · {item.locationCode}
                        </span>
                      </span>
                      <span className="shrink-0">{item.quantity}</span>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Empty locations</CardTitle>
              <CardDescription>Active bins with no on-hand quantity</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {availableLocations.length === 0 ? (
                <p className="text-muted-foreground">
                  {activeLocations.length === 0
                    ? "No active locations yet."
                    : "Every active location currently has stock."}
                </p>
              ) : (
                availableLocations.slice(0, 8).map((location) => (
                  <div
                    key={location.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {location.code}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {location.roomName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      empty
                    </span>
                  </div>
                ))
              )}
              {availableLocations.length > 8 ? (
                <p className="text-xs text-muted-foreground">
                  +{availableLocations.length - 8} more empty locations
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {canViewTransactions ? (
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <CardDescription>Putaway, shipping, and adjustments</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button nativeButton={false} variant="ghost" render={<Link href="/logbook" />}>
                Open logbook
              </Button>
              <Button nativeButton={false} variant="ghost" render={<Link href="/transactions" />}>
                Stock log
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {transactions.length === 0 ? (
              <p className="text-muted-foreground">
                No stock movements yet. Complete putaway or post an adjustment.
              </p>
            ) : (
              transactions.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    {entry.sku}
                    <span className="text-muted-foreground">
                      {" "}
                      · {entry.locationCode} · {formatDateTime(entry.occurredAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span>{formatSignedInt(entry.quantityDelta)}</span>
                    <TransactionTypeBadge type={entry.type} />
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl sm:text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

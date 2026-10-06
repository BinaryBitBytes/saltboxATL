import { notFound } from "next/navigation";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import {
  buildOrderItemLabels,
  buildOrderLoadingSheet,
  buildOrderPackSlip,
} from "@/lib/orders/documents";
import { OrderActions } from "@/frontend/client/order-actions";
import { OrderPrintBatch } from "@/frontend/client/order-documents";
import {
  CustomerOrderStatusBadge,
  PickRequestStatusBadge,
} from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("placeOrder");
  const { id } = await params;
  const system = await getSystem();
  const order = system.customerOrders.find((entry) => entry.id === id);
  if (!order) notFound();

  const locations = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );
  const canFulfill = hasPermission(user.role, "fulfillOrder");
  const pickOpen = order.status === "picking" && order.pickRequest.status === "open";
  const printLabel =
    order.printBatch.status === "printed" ? "Printed at" : "Sent to";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Order {order.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.customer} · placed by {order.placedBy} ·{" "}
            {formatDateTime(order.submittedAt)}
          </p>
        </div>
        <CustomerOrderStatusBadge status={order.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Warehouse print and pick</CardTitle>
          <CardDescription>
            {printLabel} {order.printBatch.printerName}: {order.printBatch.itemLabelCount}{" "}
            item label{order.printBatch.itemLabelCount === 1 ? "" : "s"}, a pack slip,
            and a loading sheet. That print batch opened pick{" "}
            {order.pickRequest.requestNumber}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>Pick {order.pickRequest.requestNumber}</span>
            <PickRequestStatusBadge status={order.pickRequest.status} />
          </div>
          {order.notes ? <p>Notes: {order.notes}</p> : null}
          <ul className="grid gap-1 text-muted-foreground">
            {order.lines.map((line) => (
              <li key={line.id}>
                {line.sku} · qty {line.quantity} ·{" "}
                {locations.get(line.locationId) ?? line.locationId}
              </li>
            ))}
          </ul>
          {pickOpen ? (
            <OrderActions
              orderId={order.id}
              canCancel
              canFulfill={canFulfill}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card className="print:border-0 print:shadow-none print:ring-0">
        <CardHeader className="print:hidden">
          <CardTitle>Print batch</CardTitle>
          <CardDescription>
            Item labels, pack slip, and loading sheet released to the warehouse
            label printer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrderPrintBatch
            canReprint={canFulfill}
            batch={{
              orderId: order.id,
              orderNumber: order.orderNumber,
              customer: order.customer,
              pickRequestNumber: order.pickRequest.requestNumber,
              printerName: order.printBatch.printerName,
              labels: buildOrderItemLabels(order, locations),
              packSlip: buildOrderPackSlip(order, locations),
              loadingSheet: buildOrderLoadingSheet(order, locations),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

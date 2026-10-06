import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import {
  buildOrderItemLabels,
  buildOrderLoadingSheet,
  buildOrderPackSlip,
  warehouseLabelPrinterName,
} from "@/lib/orders/documents";
import {
  WarehousePrinterQueue,
  type OrderBatchView,
} from "@/frontend/client/order-documents";
import type { CustomerOrder } from "@/lib/inventory-schema";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

function toBatch(
  order: CustomerOrder,
  locations: Map<string, string>,
): OrderBatchView {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    pickRequestNumber: order.pickRequest.requestNumber,
    printerName: order.printBatch.printerName,
    labels: buildOrderItemLabels(order, locations),
    packSlip: buildOrderPackSlip(order, locations),
    loadingSheet: buildOrderLoadingSheet(order, locations),
  };
}

export default async function WarehousePrinterPage() {
  await requirePermission("fulfillOrder");
  const system = await getSystem();
  const printerName = warehouseLabelPrinterName();
  const locations = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );
  const waiting = (system.customerOrders ?? []).filter(
    (order) =>
      order.printBatch.printerName === printerName &&
      order.printBatch.status === "dispatched",
  );
  const printed = (system.customerOrders ?? [])
    .filter(
      (order) =>
        order.printBatch.printerName === printerName &&
        order.printBatch.status === "printed",
    )
    .sort((left, right) =>
      (left.printBatch.printedAt ?? "") < (right.printBatch.printedAt ?? "") ? 1 : -1,
    )
    .slice(0, 8);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Label printer {printerName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Submitted orders release a batch here automatically: one label per
            item, a pack slip, and a loading sheet. Printing this queue is what
            the warehouse pick request is tied to.
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/orders" />}>
          Orders
        </Button>
      </div>

      <WarehousePrinterQueue
        printerName={printerName}
        jobs={waiting.map((order) => toBatch(order, locations))}
      />

      <div className="grid gap-2 print:hidden">
        <h2 className="text-sm font-medium">Recently printed</h2>
        {printed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches printed on this station yet.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {printed.map((order) => (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className="hover:underline">
                  {order.orderNumber}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  · {order.customer} · pick {order.pickRequest.requestNumber} ·{" "}
                  {formatDateTime(order.printBatch.printedAt ?? undefined)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

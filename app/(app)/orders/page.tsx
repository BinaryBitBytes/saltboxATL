import { FormattedDate, T } from "@/frontend/client/language";
import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requireAnyPermission } from "@/backend/server/dal";
import { enrichInventory } from "@/backend/server/inventory-service";
import { hasPermission } from "@/lib/auth/permissions";
import { reservedQuantity } from "@/lib/orders/availability";
import { availableToOrder } from "@/lib/orders/availability";
import { OrderForm } from "@/frontend/client/order-form";
import { CustomerOrderStatusBadge } from "@/frontend/client/status-badge";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function OrdersPage() {
  const user = await requireAnyPermission(["placeOrder", "fulfillOrder"]);
  const canPlace = hasPermission(user.role, "placeOrder");
  const system = await getSystem();
  const inventory = canPlace ? enrichInventory(system).map((row) => {
    const reserved = reservedQuantity(system.customerOrders ?? [], row.id);
    return {
      ...row,
      reserved,
      available: availableToOrder(row.quantity, reserved),
    };
  }) : [];
  const canFulfill = hasPermission(user.role, "fulfillOrder");
  const orders = [...(system.customerOrders ?? [])].sort((left, right) =>
    left.submittedAt < right.submittedAt ? 1 : left.submittedAt > right.submittedAt ? -1 : 0,
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold"><T>Orders</T></h1>
          <p className="text-sm text-muted-foreground"><T>Place a remote order against on-hand inventory. Submitting prints a label for each item, a pack slip, and a loading sheet on the warehouse label printer, which opens a pick request.</T></p>
        </div>
        {canFulfill ? (
          <Button variant="outline" nativeButton={false} render={<Link href="/orders/printer" />}>
            Warehouse label printer
          </Button>
        ) : null}
      </div>

      {canPlace ? (
        <Card>
          <CardHeader>
            <CardTitle><T>New remote order</T></CardTitle>
            <CardDescription><T>Quantities cannot exceed stock that is still available after open picks.</T></CardDescription>
          </CardHeader>
          <CardContent>
            <OrderForm inventory={inventory} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-2">
        <h2 className="text-sm font-medium"><T>Orders</T></h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><T>Order</T></TableHead>
              <TableHead><T>Customer</T></TableHead>
              <TableHead><T>Placed by</T></TableHead>
              <TableHead><T>Submitted</T></TableHead>
              <TableHead><T>Pick</T></TableHead>
              <TableHead><T>Status</T></TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground"><T>No remote orders yet.</T></TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>{order.placedBy}</TableCell>
                  <TableCell><FormattedDate value={order.submittedAt} /></TableCell>
                  <TableCell>{order.pickRequest.requestNumber}</TableCell>
                  <TableCell>
                    <CustomerOrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/orders/${order.id}`} />}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

import { FormattedDate, T } from "@/frontend/client/language";
import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { enrichInventory } from "@/backend/server/inventory-service";
import { ShippingForm } from "@/frontend/client/shipping-form";
import { ShippingStatusBadge } from "@/frontend/client/status-badge";

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

export default async function ShippingPage() {
  const user = await requirePermission("ship");
  const system = await getSystem();
  const inventory = enrichInventory(system);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Shipping</T></h1>
        <p className="text-sm text-muted-foreground"><T>Pick on-hand inventory into an outbound shipment, then print packing slips and a load manifest for the dock.</T></p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle><T>New outbound shipment</T></CardTitle>
          <CardDescription><T>Shipping associate, carrier, and contents map to Outbound_Shipped in the warehouse schema.</T></CardDescription>
        </CardHeader>
        <CardContent>
          <ShippingForm inventory={inventory} defaultShipperName={user.name} />
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium"><T>Shipments</T></h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><T>Shipment</T></TableHead>
              <TableHead><T>Customer</T></TableHead>
              <TableHead><T>Carrier</T></TableHead>
              <TableHead><T>Shipped</T></TableHead>
              <TableHead><T>Status</T></TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {system.shippingOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground"><T>No outbound shipments yet.</T></TableCell>
              </TableRow>
            ) : (
              system.shippingOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.shipmentNumber}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>{order.carrierOutbound}</TableCell>
                  <TableCell><FormattedDate value={order.shippedAt} /></TableCell>
                  <TableCell>
                    <ShippingStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/shipping/${order.id}`} />}
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

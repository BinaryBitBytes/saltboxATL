import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { enrichInventory } from "@/backend/server/inventory-service";
import { ShippingForm } from "@/frontend/client/shipping-form";
import { ShippingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
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
        <h1 className="font-heading text-xl font-semibold">Shipping</h1>
        <p className="text-sm text-muted-foreground">
          Pick on-hand inventory into an outbound shipment, then print packing
          slips and a load manifest for the dock.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New outbound shipment</CardTitle>
          <CardDescription>
            Shipping associate, carrier, and contents map to Outbound_Shipped in
            the warehouse schema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShippingForm inventory={inventory} defaultShipperName={user.name} />
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Shipments</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shipment</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Shipped</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {system.shippingOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No outbound shipments yet.
                </TableCell>
              </TableRow>
            ) : (
              system.shippingOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.shipmentNumber}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>{order.carrierOutbound}</TableCell>
                  <TableCell>{formatDateTime(order.shippedAt)}</TableCell>
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

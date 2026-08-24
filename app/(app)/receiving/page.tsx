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
import ReceivingForm from "@/frontend/client/reactHookForm";
import { ReceivingStatusBadge } from "@/frontend/client/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReceivingPage() {
  const user = await requirePermission("receive");
  const system = await getSystem();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Receiving</h1>
        <p className="text-sm text-muted-foreground">
          Create an inbound order from a purchase order, then work pallets and
          cases. Putaway is a separate step after receiving is complete.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New inbound order</CardTitle>
          <CardDescription>
            Matches PO #, vendor, carrier, receiver, and pallet count from the
            warehouse schema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReceivingForm defaultReceiverName={user.name} />
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Receiving orders</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Pallets</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {system.receivingOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No receiving orders yet.
                </TableCell>
              </TableRow>
            ) : (
              system.receivingOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.poNumber}</TableCell>
                  <TableCell>{order.vendor}</TableCell>
                  <TableCell>{formatDateTime(order.receivedAt)}</TableCell>
                  <TableCell>
                    {order.pallets.length}/{order.loadPalletCount}
                  </TableCell>
                  <TableCell>
                    <ReceivingStatusBadge
                      status={order.status}
                      isPartialed={order.isPartialed}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/receiving/${order.id}`} />}
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

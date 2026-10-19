import { FormattedDate, T } from "@/frontend/client/language";
import Link from "next/link";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
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

import { formatJobId, jobIdForPurchaseOrder } from "@/lib/purchase-orders";
import { buildInboundForecast } from "@/lib/inbound/forecast";
import type { ExpectedPoPreset } from "@/frontend/client/reactHookForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const user = await requirePermission("receive");
  const { po: selectedPo } = await searchParams;
  const system = await getSystem();
  const forecast = buildInboundForecast(
    system.purchaseOrders,
    system.receivingOrders,
  );
  const expectedRows = forecast.rows.filter(
    (row) => row.derivedStatus === "expected" || row.derivedStatus === "in-transit",
  );
  const presets: ExpectedPoPreset[] = expectedRows.map((row) => ({
    purchaseOrderNumber: row.purchaseOrderNumber,
    vendor: row.vendor,
    carrier: row.carrier,
    expectedPalletCount: row.expectedPalletCount,
    jobIdNumber: row.jobIdNumber,
  }));
  const initial =
    presets.find((preset) => preset.purchaseOrderNumber === selectedPo) ?? null;

  function openExpectedLoad(purchaseOrderNumber: string) {
    return system.receivingOrders.find(
      (order) =>
        order.poNumber === purchaseOrderNumber &&
        order.status !== "cancelled" &&
        order.status !== "completed" &&
        order.status !== "received",
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Receiving</T></h1>
        <p className="text-sm text-muted-foreground"><T>Create an inbound order from a purchase order, then work pallets and cases. Putaway is a separate step after receiving is complete.</T></p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle><T>Expected POs</T></CardTitle>
          <CardDescription><T>Coordinator purchases waiting on the dock. Use one to start receiving without retyping the PO, vendor, or carrier.</T></CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {expectedRows.length === 0 ? (
            <p className="text-muted-foreground"><T>No expected purchase orders.</T></p>
          ) : (
            expectedRows.map((row) => {
              const open = openExpectedLoad(row.purchaseOrderNumber);
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <p>PO {row.purchaseOrderNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.vendor} · {row.carrier} · <T>Job ID</T> {formatJobId(row.jobIdNumber)}
                    </p>
                  </div>
                  {open ? (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/receiving/${open.id}`} />}
                    >
                      Open expected load
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/receiving?po=${encodeURIComponent(row.purchaseOrderNumber)}`}
                        />
                      }
                    >
                      Use for receiving
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle><T>New inbound order</T></CardTitle>
          <CardDescription><T>Matches PO #, vendor, carrier, receiver, and pallet count. Job IDs are assigned by a project manager on the inbound board.</T></CardDescription>
        </CardHeader>
        <CardContent>
          <ReceivingForm
            key={initial?.purchaseOrderNumber ?? "new"}
            defaultReceiverName={user.name}
            canAssignJobId={hasPermission(user.role, "assignJobId")}
            presets={presets}
            initial={initial}
          />
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <h2 className="text-sm font-medium"><T>Receiving orders</T></h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><T>Order</T></TableHead>
              <TableHead>PO</TableHead>
              <TableHead><T>Job ID</T></TableHead>
              <TableHead><T>Vendor</T></TableHead>
              <TableHead><T>Received</T></TableHead>
              <TableHead><T>Pallets</T></TableHead>
              <TableHead><T>Status</T></TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {system.receivingOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground"><T>No receiving orders yet.</T></TableCell>
              </TableRow>
            ) : (
              system.receivingOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.poNumber}</TableCell>
                  <TableCell>
                    {formatJobId(
                      jobIdForPurchaseOrder(system.purchaseOrders, order.poNumber),
                    )}
                  </TableCell>
                  <TableCell>{order.vendor}</TableCell>
                  <TableCell><FormattedDate value={order.receivedAt} /></TableCell>
                  <TableCell>
                    {order.pallets.length}/{order.loadPalletCount}
                  </TableCell>
                  <TableCell>
                    <ReceivingStatusBadge
                      status={order.status}
                      isPartialed={order.isPartialed}
                      intake={order.intake}
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

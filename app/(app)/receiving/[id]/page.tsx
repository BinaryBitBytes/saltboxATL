import { notFound } from "next/navigation";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { ReceivingWorkspace, ReopenAsPartialControls } from "@/frontend/client/receiving-workspace";
import { ReceivingStatusBadge } from "@/frontend/client/status-badge";
import { PhotoProofCollector } from "@/frontend/client/photo-proof";
import { collectKnownProducts } from "@/lib/codes/product-codes";
import { photosForOwnerKind } from "@/lib/photos/query";
import { hasPermission } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";
import { remainingExpectedPallets } from "@/lib/receiving/reopen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ReceivingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("receive");
  const { id } = await params;
  const system = await getSystem();
  const order = system.receivingOrders.find((entry) => entry.id === id);
  if (!order) notFound();
  const photos = system.photos ?? [];
  const canEditPhotos = order.status !== "cancelled";
  const remaining = remainingExpectedPallets(order);
  const canReopen = hasPermission(user.role, "reopenReceiving");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Receiving {order.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.vendor} · carrier {order.carrierInbound} · received{" "}
            {formatDateTime(order.receivedAt)}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ReceivingStatusBadge
            status={order.status}
            isPartialed={order.isPartialed}
          />
          {canReopen &&
          order.status === "completed" &&
          remaining > 0 ? (
            <ReopenAsPartialControls order={order} compact />
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order header</CardTitle>
          <CardDescription>PO {order.poNumber}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Receiver" value={order.receiverName} />
          <Detail
            label="Expected pallets"
            value={String(order.loadPalletCount)}
          />
          <Detail
            label="Received / remaining"
            value={`${order.pallets.length} received · ${remaining} remaining`}
          />
          <Detail
            label="Working pallet"
            value={
              order.pallets.find((pallet) => pallet.id === order.workingPalletId)
                ?.palletNumber ?? "—"
            }
          />
          <Detail label="Notes" value={order.notes || "—"} />
          {order.isPartialed ? (
            <Detail
              label="Partialed"
              value={
                order.partialedBy
                  ? `Yes · ${order.partialedBy}`
                  : "Yes"
              }
            />
          ) : null}
        </CardContent>
      </Card>

      <PhotoProofCollector
        ownerType="receiving-order"
        ownerId={order.id}
        documentKind="freight-proof"
        photos={photosForOwnerKind(photos, "receiving-order", order.id, "freight-proof")}
        canEdit={canEditPhotos}
        title="Proof of inbound freight"
        description={`Freight photos for PO ${order.poNumber} — pallets, seals, and condition. Keep manifests and pack slips in the document fields below.`}
      />

      <div className="grid gap-6 min-[56rem]:grid-cols-3">
        <PhotoProofCollector
          ownerType="receiving-order"
          ownerId={order.id}
          documentKind="manifest"
          photos={photosForOwnerKind(photos, "receiving-order", order.id, "manifest")}
          canEdit={canEditPhotos}
          title="Manifest"
          description="Attach the inbound manifest."
          emptyLabel="No manifest photos attached yet."
        />
        <PhotoProofCollector
          ownerType="receiving-order"
          ownerId={order.id}
          documentKind="load-sheet"
          photos={photosForOwnerKind(photos, "receiving-order", order.id, "load-sheet")}
          canEdit={canEditPhotos}
          title="Load sheet"
          description="Attach the load sheet."
          emptyLabel="No load sheet photos attached yet."
        />
        <PhotoProofCollector
          ownerType="receiving-order"
          ownerId={order.id}
          documentKind="pack-slip"
          photos={photosForOwnerKind(photos, "receiving-order", order.id, "pack-slip")}
          canEdit={canEditPhotos}
          title="Pack slips"
          description="Attach packing slips."
          emptyLabel="No pack slip photos attached yet."
        />
      </div>

      <ReceivingWorkspace
        order={order}
        knownProducts={collectKnownProducts(system)}
        canReopen={canReopen}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}

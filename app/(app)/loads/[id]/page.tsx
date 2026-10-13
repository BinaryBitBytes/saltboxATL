import { notFound } from "next/navigation";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import { photosForOwnerKind } from "@/lib/photos/query";
import { buildLoadManifest, buildPackSlip } from "@/lib/shipping/documents";
import { formatDateTime } from "@/lib/format";
import { DeliveryCheckIn } from "@/frontend/client/delivery-check-in";
import { DeliveryProgressView } from "@/frontend/client/delivery-progress";
import { PhotoProofCollector } from "@/frontend/client/photo-proof";
import {
  LoadManifestSheet,
  PackSlipSheet,
} from "@/frontend/client/shipment-documents";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("viewDriverLoad");
  const { id } = await params;
  const system = await getSystem();
  const order = system.shippingOrders.find((entry) => entry.id === id);
  if (!order || order.status === "cancelled") notFound();

  const canConfirm = hasPermission(user.role, "confirmDelivery");
  const locations = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );
  const photos = photosForOwnerKind(
    system.photos ?? [],
    "shipping-order",
    order.id,
    "proof-of-delivery",
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Load {order.shipmentNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.customer} · {order.carrierOutbound} ·{" "}
            {formatDateTime(order.shippedAt)}
          </p>
        </div>
        <Badge variant="outline">{order.shipperName}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Check-in</CardTitle>
          <CardDescription>
            Scan a pallet label to check in that pallet, or a case label to
            check in one case. Each scan stores the server time and the
            device location when it is available.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <DeliveryProgressView order={order} />
          {canConfirm ? (
            <DeliveryCheckIn
              shipmentId={order.id}
              notes={order.delivery?.notes ?? ""}
            />
          ) : null}
        </CardContent>
      </Card>

      <PhotoProofCollector
        ownerType="shipping-order"
        ownerId={order.id}
        photos={photos}
        canEdit={canConfirm}
        documentKind="proof-of-delivery"
        title="Proof of delivery"
        description="Delivery photos stay on this load. Drivers cannot change inventory, pick quantities, or shipment headers."
        emptyLabel="No proof of delivery photos yet."
      />

      <Card>
        <CardHeader>
          <CardTitle>Manifest and pack list</CardTitle>
          <CardDescription>
            Read-only documents for this load. Printing does not change the shipment.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LoadManifestSheet doc={buildLoadManifest(order, locations)} />
          <PackSlipSheet doc={buildPackSlip(order, locations)} />
        </CardContent>
      </Card>
    </div>
  );
}

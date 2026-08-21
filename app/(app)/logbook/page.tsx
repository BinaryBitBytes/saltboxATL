import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import { buildLogbookEntries } from "@/lib/logbook/entries";
import { LogbookWorkspace } from "@/frontend/client/logbook-workspace";

export default async function LogbookPage() {
  const user = await requireUser();
  const system = await getSystem();
  const locationCodes = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );
  const entries = buildLogbookEntries({
    receivingOrders: system.receivingOrders,
    shippingOrders: system.shippingOrders,
    transactions: system.transactions,
    photos: system.photos ?? [],
    locationCodes,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Logbook</h1>
        <p className="text-sm text-muted-foreground">
          Review outbound shipments, inbound deliveries, and damage write-offs,
          including packing documents and proof photos.
        </p>
      </div>
      <LogbookWorkspace
        entries={entries}
        canOpenShipments={hasPermission(user.role, "ship")}
        canOpenDeliveries={hasPermission(user.role, "receive")}
        canOpenInventory={hasPermission(user.role, "viewInventory")}
      />
    </div>
  );
}

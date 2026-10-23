import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { enrichInventory, enrichTransactions } from "@/backend/server/inventory-service";
import { reservedQuantity } from "@/lib/orders/availability";
import { RfMoveForm, type MoveLine } from "@/frontend/client/rf-move-form";

export default async function MovesPage() {
  await requirePermission("moveInventory");
  const system = await getSystem();
  const lines: MoveLine[] = enrichInventory(system).map((row) => ({
    ...row,
    available: Math.max(0, row.quantity - reservedQuantity(system.customerOrders, row.id)),
  }));
  const recent = enrichTransactions(system)
    .filter((entry) => entry.type === "move" && entry.quantityDelta < 0)
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      sku: entry.sku,
      quantity: Math.abs(entry.quantityDelta),
      fromCode: entry.locationCode,
      toCode: entry.destinationLocationCode ?? "—",
    }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          <T>RF Moves</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Scan the bin you are taking from, then the bin you are putting into. Open-order reservations stay in place, and the destination cube still has to fit.
          </T>
        </p>
      </div>
      <RfMoveForm lines={lines} locations={system.locations} recent={recent} />
    </div>
  );
}

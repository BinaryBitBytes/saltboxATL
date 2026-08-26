import { getSystem } from "@/backend/server/store";
import { enrichInventory } from "@/backend/server/inventory-service";
import { requireUser } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import { InventoryWorkspace } from "@/frontend/client/inventory-workspace";

export default async function InventoryPage() {
  const user = await requireUser();
  const system = await getSystem();
  const rows = enrichInventory(system);
  const canAdjust = hasPermission(user.role, "adjustInventory");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          On-hand quantities, spreadsheet import/export, barcode/QR labels, and
          location label printing
          {canAdjust ? ", plus overage / shortage / damage adjustments." : "."}
        </p>
      </div>
      <InventoryWorkspace
        rows={rows}
        locations={system.locations}
        rooms={system.rooms}
        canAdjust={canAdjust}
      />
    </div>
  );
}

import { getSystem } from "@/backend/server/store";
import { enrichInventory } from "@/backend/server/inventory-service";
import { InventoryTable } from "@/frontend/client/inventory-table";

export default async function InventoryPage() {
  const system = await getSystem();
  const rows = enrichInventory(system);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          On-hand quantities by SKU, batch, room, and putaway location.
        </p>
      </div>
      <InventoryTable initialRows={rows} />
    </div>
  );
}

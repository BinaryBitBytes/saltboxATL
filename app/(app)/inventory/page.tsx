import { getSystem } from "@/backend/server/store";
import { enrichInventory } from "@/backend/server/inventory-service";
import { requireUser } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCubingLocations } from "@/lib/cubing/capacity";
import { InventoryWorkspace } from "@/frontend/client/inventory-workspace";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";

export default async function InventoryPage() {
  const user = await requireUser();
  const system = await getSystem();
  const rows = enrichInventory(system);
  const canAdjust = hasPermission(user.role, "adjustInventory");
  const roomNames = new Map(system.rooms.map((room) => [room.id, room.name]));
  const locationCubes: LocationCubeRow[] = buildCubingLocations({
    locations: system.locations,
    items: system.inventoryItems,
    orders: system.receivingOrders,
    cubes: system.itemCubes,
  }).map((location) => {
    const source = system.locations.find((entry) => entry.id === location.id);
    return {
      ...location,
      roomName: source ? (roomNames.get(source.roomId) ?? "Unknown room") : "Unknown room",
    };
  });

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
        cubes={system.itemCubes}
        locationCubes={locationCubes}
      />
    </div>
  );
}

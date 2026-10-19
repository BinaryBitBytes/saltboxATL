import { T } from "@/frontend/client/language";
import { getTranslator } from "@/lib/i18n/server";
import { getSystem } from "@/backend/server/store";
import { enrichInventory } from "@/backend/server/inventory-service";
import { requireUser } from "@/backend/server/dal";
import { resolveActiveDivision } from "@/backend/server/division";
import { divisionLabel } from "@/lib/divisions";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCubingLocations } from "@/lib/cubing/capacity";
import { InventoryWorkspace } from "@/frontend/client/inventory-workspace";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";

export default async function InventoryPage() {
  const { t } = await getTranslator();
  const user = await requireUser();
  const division = await resolveActiveDivision();
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
        <h1 className="font-heading text-xl font-semibold"><T>Inventory</T></h1>
        <p className="text-sm text-muted-foreground">
          {canAdjust
            ? t(
                "{{division}} on-hand quantities, spreadsheet import/export, barcode/QR labels, and location label printing, plus overage / shortage / damage adjustments.",
                { division: t(divisionLabel(division)) },
              )
            : t(
                "{{division}} on-hand quantities, spreadsheet import/export, barcode/QR labels, and location label printing.",
                { division: t(divisionLabel(division)) },
              )}
        </p>
      </div>
      <InventoryWorkspace
        key={division}
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

import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { enrichInventory } from "@/backend/server/inventory-service";
import { buildCubingLocations } from "@/lib/cubing/capacity";
import { buildDamageReport } from "@/lib/inventory/damage";
import { DamageWorkspace } from "@/frontend/client/damage-workspace";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";

export default async function DamagesPage() {
  await requirePermission("damageInventory");
  const system = await getSystem();
  const report = buildDamageReport(system.transactions);
  const locationCodes = new Map(
    system.locations.map((location) => [location.id, location.code]),
  );
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
        <h1 className="font-heading text-xl font-semibold">
          <T>Damages</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Scan a SKU or bin, choose a reason, and damage out the quantity. Managers and associates report damage only on this tab.
          </T>
        </p>
      </div>
      <DamageWorkspace
        inventory={enrichInventory(system)}
        locations={system.locations}
        cubes={system.itemCubes}
        locationCubes={locationCubes}
        totals={report.totals}
        rows={report.events.map((event) => ({
          ...event,
          sourceLocationCode: event.sourceLocationId
            ? (locationCodes.get(event.sourceLocationId) ?? "—")
            : "—",
          holdLocationCode: event.holdLocationId
            ? (locationCodes.get(event.holdLocationId) ?? "—")
            : "—",
        }))}
      />
    </div>
  );
}

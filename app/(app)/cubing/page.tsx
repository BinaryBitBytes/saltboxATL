import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCubingLocations } from "@/lib/cubing/capacity";
import { CubingWorkspace } from "@/frontend/client/cubing-workspace";
import type { LocationCubeRow } from "@/frontend/client/location-cube-table";

export default async function CubingPage() {
  const user = await requirePermission("cube");
  const system = await getSystem();
  const roomNames = new Map(system.rooms.map((room) => [room.id, room.name]));
  const cubingLocations = buildCubingLocations({
    locations: system.locations,
    items: system.inventoryItems,
    orders: system.receivingOrders,
    cubes: system.itemCubes,
  });
  const locationRows: LocationCubeRow[] = cubingLocations.map((location) => {
    const source = system.locations.find((entry) => entry.id === location.id);
    return {
      ...location,
      roomName: source ? (roomNames.get(source.roomId) ?? "Unknown room") : "Unknown room",
    };
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Cubing</h1>
        <p className="text-sm text-muted-foreground">
          Receivers and inventory control cube each case as length × width × height
          in inches, rounded up to the nearest quarter inch. That cube keeps putaway
          and inventory from directing a quantity that is too large for a location.
        </p>
      </div>
      <CubingWorkspace
        cubes={system.itemCubes}
        locations={system.locations}
        locationRows={locationRows}
        canEditLocations={hasPermission(user.role, "manageLocations")}
      />
    </div>
  );
}

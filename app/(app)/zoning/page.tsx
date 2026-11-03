import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { ZoningWorkspace, type ZoningLine } from "@/frontend/client/zoning-workspace";
import { divisionOf } from "@/lib/divisions";

export default async function ZoningPage() {
  await requirePermission("zoneWarehouse");
  const system = await getSystem();
  const rooms = new Map(system.rooms.map((room) => [room.id, room.name]));
  const locationCodes = new Map(system.locations.map((location) => [location.id, location.code]));
  const lines: ZoningLine[] = system.inventoryItems.map((item) => ({
    id: item.id,
    sku: item.sku,
    description: item.description?.trim() || "—",
    quantity: item.quantity,
    locationCode: locationCodes.get(item.locationId) ?? "—",
    roomName: rooms.get(
      system.locations.find((location) => location.id === item.locationId)?.roomId ?? "",
    ) ?? "—",
    zoneId: item.zoneId ?? null,
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          <T>Zoning</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Categorize inventory lines into warehouse zones, then open many bins at once. Cube settings use the same case measure and location capacity as Cubing, and each bin address follows the location schema.
          </T>
        </p>
      </div>
      <ZoningWorkspace
        division={divisionOf(system.sites[0] ?? system.locations[0])}
        lines={lines}
        sites={system.sites}
        buildings={system.buildings}
        zones={system.zones}
        aisles={system.aisles}
        bays={system.bays}
        locations={system.locations}
        inventoryItems={system.inventoryItems}
        receivingOrders={system.receivingOrders}
        itemCubes={system.itemCubes}
      />
    </div>
  );
}

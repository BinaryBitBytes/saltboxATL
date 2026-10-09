import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { enrichInventory } from "@/backend/server/inventory-service";
import { hasPermission } from "@/lib/auth/permissions";
import { reservedQuantity } from "@/lib/orders/availability";
import { RfMovesWorkspace } from "@/frontend/client/rf-moves-workspace";

export default async function MovesPage() {
  const user = await requirePermission("moveInventory");
  const system = await getSystem();
  const locationById = new Map(system.locations.map((location) => [location.id, location]));
  const roomName = new Map(system.rooms.map((room) => [room.id, room.name]));
  const lines = enrichInventory(system)
    .filter((row) => row.quantity > 0)
    .map((row) => {
      const reserved = reservedQuantity(system.customerOrders ?? [], row.id);
      const location = locationById.get(row.locationId);
      return {
        id: row.id,
        sku: row.sku,
        description: row.description ?? row.sku,
        batch: row.batch,
        locationId: row.locationId,
        locationCode: row.locationCode,
        roomId: location?.roomId ?? "",
        roomName: row.roomName,
        quantity: row.quantity,
        reserved,
        available: Math.max(0, row.quantity - reserved),
        projectId: row.projectId,
      };
    });
  const locations = system.locations
    .filter((location) => location.isActive)
    .map((location) => ({
      id: location.id,
      code: location.code,
      roomId: location.roomId,
      roomName: roomName.get(location.roomId) ?? "Unknown room",
      storageClass: location.storageClass,
    }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">RF Moves</h1>
        <p className="text-sm text-muted-foreground">
          Move stock between locations, consolidate a SKU into one place, or load a transfer trailer for another building.
        </p>
      </div>
      <RfMovesWorkspace
        lines={lines}
        locations={locations}
        rooms={system.rooms}
        transfers={system.siteTransfers ?? []}
        canApprove={hasPermission(user.role, "approveProjectCombine")}
      />
    </div>
  );
}

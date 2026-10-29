import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { LocationForms } from "@/frontend/client/location-forms";
import { NomenclatureForms } from "@/frontend/client/nomenclature-forms";
import { formatCubicInches, storageClassLabel } from "@/lib/cubing/measure";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Location } from "@/lib/inventory-schema";
import { padNumber } from "@/lib/locations/nomenclature";
import { buildWarehouseTree } from "@/lib/sites/database";
import { WarehouseTree } from "@/frontend/client/warehouse-tree";

function slotLabel(location: Location): string {
  if (location.slotKind === "pick" && location.height && location.position) {
    return `Pick ${location.height}${padNumber(location.position, 2)}`;
  }
  if (location.slotKind === "overhead" && location.height && location.side) {
    return `Overhead ${location.height}${location.side}`;
  }
  return "Legacy";
}

export default async function LocationsPage() {
  await requirePermission("manageLocations");
  const system = await getSystem();
  const rooms = new Map(system.rooms.map((room) => [room.id, room.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Rooms & locations</T></h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Bin labels start with the site codename, then building, zone, aisle, bay, and slot. Trailers, license plates, and containers are separate scans. Legacy room codes stay available for dock, hold, and pallet lanes.
          </T>
        </p>
      </div>

      <WarehouseTree nodes={buildWarehouseTree(system)} />

      <NomenclatureForms
        sites={system.sites}
        buildings={system.buildings}
        zones={system.zones}
        aisles={system.aisles}
        bays={system.bays}
        trailers={system.trailers}
        licensePlates={system.licensePlates}
        containers={system.containers}
        locations={system.locations}
      />

      <LocationForms rooms={system.rooms} />

      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><T>Code</T></TableHead>
            <TableHead><T>Slot</T></TableHead>
            <TableHead><T>Room</T></TableHead>
            <TableHead><T>Class</T></TableHead>
            <TableHead><T>Cube capacity</T></TableHead>
            <TableHead><T>Description</T></TableHead>
            <TableHead><T>Active</T></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {system.locations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground"><T>Add a room, then a location code.</T></TableCell>
            </TableRow>
          ) : (
            system.locations.map((location) => (
              <TableRow key={location.id}>
                <TableCell className="font-mono">{location.code}</TableCell>
                <TableCell>{slotLabel(location)}</TableCell>
                <TableCell>{rooms.get(location.roomId) ?? "—"}</TableCell>
                <TableCell>
                  <T>{storageClassLabel(location.storageClass)}</T>
                </TableCell>
                <TableCell>{formatCubicInches(location.cubeCapacityCubicInches)}</TableCell>
                <TableCell>{location.description || "—"}</TableCell>
                <TableCell>
                  <T>{location.isActive ? "Yes" : "No"}</T>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>

      {system.zones.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><T>Zone</T></TableHead>
                <TableHead><T>Item type</T></TableHead>
                <TableHead><T>Cube size</T></TableHead>
                <TableHead><T>Project</T></TableHead>
                <TableHead><T>PO</T></TableHead>
                <TableHead><T>Inbound</T></TableHead>
                <TableHead><T>Outbound</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {system.zones.map((zone) => {
                const building = system.buildings.find((entry) => entry.id === zone.buildingId);
                const site = system.sites.find((entry) => entry.id === building?.siteId);
                const address = `${site?.codename ?? "SITE"}-${String(building?.number ?? 0).padStart(3, "0")}-${zone.letter}`;
                return (
                  <TableRow key={zone.id}>
                    <TableCell className="font-mono">{address}</TableCell>
                    <TableCell>{zone.itemType}</TableCell>
                    <TableCell>{zone.cubeSize}</TableCell>
                    <TableCell>{zone.projectId || "—"}</TableCell>
                    <TableCell>{zone.poNumber || "—"}</TableCell>
                    <TableCell>{zone.inboundVelocity}</TableCell>
                    <TableCell>{zone.outboundVelocity}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { LocationForms } from "@/frontend/client/location-forms";
import { formatCubicInches, storageClassLabel } from "@/lib/cubing/measure";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function LocationsPage() {
  await requirePermission("manageLocations");
  const system = await getSystem();
  const rooms = new Map(system.rooms.map((room) => [room.id, room.name]));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Rooms & locations</T></h1>
        <p className="text-sm text-muted-foreground"><T>Putaway rooms and bin locations used when receiving cases.</T></p>
      </div>

      <LocationForms rooms={system.rooms} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><T>Code</T></TableHead>
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
              <TableCell colSpan={6} className="text-muted-foreground"><T>Add a room, then a location code.</T></TableCell>
            </TableRow>
          ) : (
            system.locations.map((location) => (
              <TableRow key={location.id}>
                <TableCell>{location.code}</TableCell>
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
  );
}

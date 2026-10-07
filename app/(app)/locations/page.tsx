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
        <h1 className="font-heading text-xl font-semibold">Rooms & locations</h1>
        <p className="text-sm text-muted-foreground">
          Putaway rooms and bin locations used when receiving cases.
        </p>
      </div>

      <LocationForms rooms={system.rooms} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Cube capacity</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {system.locations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Add a room, then a location code.
              </TableCell>
            </TableRow>
          ) : (
            system.locations.map((location) => (
              <TableRow key={location.id}>
                <TableCell>{location.code}</TableCell>
                <TableCell>{rooms.get(location.roomId) ?? "—"}</TableCell>
                <TableCell>{storageClassLabel(location.storageClass)}</TableCell>
                <TableCell>{formatCubicInches(location.cubeCapacityCubicInches)}</TableCell>
                <TableCell>{location.description || "—"}</TableCell>
                <TableCell>{location.isActive ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

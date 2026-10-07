import {
  formatCubicInches,
  roundCube,
  storageClassLabel,
} from "@/lib/cubing/measure";
import type { CubingLocation } from "@/lib/cubing/workflow";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type LocationCubeRow = CubingLocation & { roomName: string };

export function LocationCubeTable({ locations }: { locations: LocationCubeRow[] }) {
  const rows = [...locations].sort((left, right) => left.code.localeCompare(right.code));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead>Room</TableHead>
          <TableHead>Class</TableHead>
          <TableHead>Capacity</TableHead>
          <TableHead>Committed</TableHead>
          <TableHead>Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground">
              Add a location before cube can be reserved.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((location) => {
            const open = roundCube(
              location.cubeCapacityCubicInches - location.committedCubicInches,
            );
            return (
              <TableRow key={location.id}>
                <TableCell>{location.code}</TableCell>
                <TableCell>{location.roomName}</TableCell>
                <TableCell>{storageClassLabel(location.storageClass)}</TableCell>
                <TableCell>{formatCubicInches(location.cubeCapacityCubicInches)}</TableCell>
                <TableCell>{formatCubicInches(location.committedCubicInches)}</TableCell>
                <TableCell className={open < 0 ? "text-destructive" : undefined}>
                  {formatCubicInches(open)}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

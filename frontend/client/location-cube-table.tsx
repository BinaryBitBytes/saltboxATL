import { T } from "@/frontend/client/language";
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
          <TableHead><T>Location</T></TableHead>
          <TableHead><T>Room</T></TableHead>
          <TableHead><T>Class</T></TableHead>
          <TableHead><T>Capacity</T></TableHead>
          <TableHead><T>Committed</T></TableHead>
          <TableHead><T>Open cube</T></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground"><T>Add a location before cube can be reserved.</T></TableCell>
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
                <TableCell>
                  <T>{storageClassLabel(location.storageClass)}</T>
                </TableCell>
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

"use client";

import { useState } from "react";
import type { InventoryRow, ItemCube, Location, Room } from "@/lib/inventory-schema";
import { InventoryTable } from "@/frontend/client/inventory-table";
import { AdjustmentForm } from "@/frontend/client/adjustment-form";
import { LocationLabelMaker } from "@/frontend/client/location-label-maker";
import { InventorySpreadsheetCard } from "@/frontend/client/inventory-spreadsheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LocationCubeTable,
  type LocationCubeRow,
} from "@/frontend/client/location-cube-table";

export function InventoryWorkspace({
  rows,
  locations,
  rooms,
  canAdjust = false,
  cubes = [],
  locationCubes = [],
}: {
  rows: InventoryRow[];
  locations: Location[];
  rooms: Room[];
  canAdjust?: boolean;
  cubes?: ItemCube[];
  locationCubes?: LocationCubeRow[];
}) {
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  return (
    <div className="grid gap-6">
      <InventorySpreadsheetCard canImport={canAdjust} />
      <div
        className={
          canAdjust
            ? "grid gap-6 min-[56rem]:grid-cols-[minmax(0,1fr)_22rem]"
            : "grid gap-6"
        }
      >
        <InventoryTable
          initialRows={rows}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
        />
        {canAdjust ? (
          <AdjustmentForm
            inventory={rows}
            locations={locations}
            cubes={cubes}
            locationCubes={locationCubes}
            selectedItemId={selectedItemId}
            onSelectedItemIdChange={setSelectedItemId}
          />
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Location cube</CardTitle>
          <CardDescription>
            On-hand quantities stay inside each location&apos;s cube. An overage that
            would exceed the open cube is rejected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LocationCubeTable locations={locationCubes} />
        </CardContent>
      </Card>
      <LocationLabelMaker rooms={rooms} locations={locations} />
    </div>
  );
}

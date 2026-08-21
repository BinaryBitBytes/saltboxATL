"use client";

import { useState } from "react";
import type { InventoryRow, Location, Room } from "@/lib/inventory-schema";
import { InventoryTable } from "@/frontend/client/inventory-table";
import { AdjustmentForm } from "@/frontend/client/adjustment-form";
import { LocationLabelMaker } from "@/frontend/client/location-label-maker";

export function InventoryWorkspace({
  rows,
  locations,
  rooms,
  canAdjust = false,
}: {
  rows: InventoryRow[];
  locations: Location[];
  rooms: Room[];
  canAdjust?: boolean;
}) {
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  return (
    <div className="grid gap-6">
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
            selectedItemId={selectedItemId}
            onSelectedItemIdChange={setSelectedItemId}
          />
        ) : null}
      </div>
      <LocationLabelMaker rooms={rooms} locations={locations} />
    </div>
  );
}

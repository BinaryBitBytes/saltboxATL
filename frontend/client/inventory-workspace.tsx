"use client";

import { useState } from "react";
import type { InventoryRow, Location } from "@/lib/inventory-schema";
import { InventoryTable } from "@/frontend/client/inventory-table";
import { AdjustmentForm } from "@/frontend/client/adjustment-form";

export function InventoryWorkspace({
  rows,
  locations,
}: {
  rows: InventoryRow[];
  locations: Location[];
}) {
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <InventoryTable
        initialRows={rows}
        selectedItemId={selectedItemId}
        onSelectItem={setSelectedItemId}
      />
      <AdjustmentForm
        inventory={rows}
        locations={locations}
        selectedItemId={selectedItemId}
        onSelectedItemIdChange={setSelectedItemId}
      />
    </div>
  );
}

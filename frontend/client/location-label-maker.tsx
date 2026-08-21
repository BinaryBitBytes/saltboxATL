"use client";

import { useMemo, useState } from "react";
import type { Location, Room } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LabelPrintSheet } from "@/frontend/client/label-sheet";
import {
  buildLocationLabels,
  locationsWithRooms,
} from "@/lib/labels/build-labels";

export function LocationLabelMaker({
  rooms,
  locations,
}: {
  rooms: Room[];
  locations: Location[];
}) {
  const labeled = useMemo(
    () => locationsWithRooms(locations, rooms),
    [locations, rooms],
  );
  const [roomId, setRoomId] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filtered = labeled.filter((location) => {
    if (activeOnly && !location.isActive) return false;
    if (roomId !== "all" && location.roomId !== roomId) return false;
    return true;
  });

  const selected = filtered.filter((location) =>
    selectedIds.includes(location.id),
  );
  const labels = buildLocationLabels(selected);

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  return (
    <Card className="print:border-0 print:shadow-none print:ring-0">
      <CardHeader className="print:hidden">
        <CardTitle>Location label maker</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 print:hidden sm:grid-cols-2">
          <Field label="Room">
            <NativeSelect
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
                setSelectedIds([]);
              }}
            >
              <option value="all">All rooms</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-end gap-2 pb-1 text-xs">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => {
                setActiveOnly(event.target.checked);
                setSelectedIds([]);
              }}
            />
            Active locations only
          </label>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSelectedIds(filtered.map((location) => location.id))}
          >
            Select filtered ({filtered.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds([])}
          >
            Clear
          </Button>
        </div>
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-2 print:hidden">
          {filtered.length === 0 ? (
            <li className="text-xs text-muted-foreground">No locations match.</li>
          ) : (
            filtered.map((location) => (
              <li key={location.id}>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(location.id)}
                    onChange={() => toggle(location.id)}
                  />
                  <span>
                    {location.code}
                    <span className="text-muted-foreground">
                      {" "}
                      · {location.roomName}
                      {location.isActive ? "" : " · inactive"}
                    </span>
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <LabelPrintSheet
          title="Location labels"
          description="Print bin labels to scan during putaway and inventory counts."
          labels={labels}
        />
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItemCube, Location } from "@/lib/inventory-schema";
import { STORAGE_CLASSES } from "@/lib/inventory-schema";
import {
  formatCubicInches,
  formatInches,
  measureCaseCube,
  storageClassLabel,
  type StorageClass,
} from "@/lib/cubing/measure";
import { saveItemCube, updateLocationCapacity } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import {
  LocationCubeTable,
  type LocationCubeRow,
} from "@/frontend/client/location-cube-table";

export function CubingWorkspace({
  cubes,
  locations,
  locationRows,
  canEditLocations,
}: {
  cubes: ItemCube[];
  locations: Location[];
  locationRows: LocationCubeRow[];
  canEditLocations: boolean;
}) {
  return (
    <div className="grid gap-6">
      <CubeItemForm cubes={cubes} />
      <Card>
        <CardHeader>
          <CardTitle>Cubed items</CardTitle>
          <CardDescription>
            Case dimensions already rounded up to the nearest quarter inch.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {cubes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items have been cubed yet.
            </p>
          ) : (
            cubes.map((cube) => (
              <div key={cube.sku} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className="font-medium">{cube.sku}</p>
                <p className="text-muted-foreground">
                  {cube.description || "No description"} · {formatInches(cube.lengthInches)} ×{" "}
                  {formatInches(cube.widthInches)} × {formatInches(cube.heightInches)} ·{" "}
                  {formatCubicInches(cube.cubicInches)} · {cube.unitsPerCase}{" "}
                  {cube.unitsPerCase === 1 ? "unit" : "units"} per case
                  {cube.cubedBy ? ` · ${cube.cubedBy}` : ""}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Location capacities</CardTitle>
          <CardDescription>
            Committed cube is on-hand stock plus cases already assigned to putaway.
            A quantity that would exceed the open cube is not directed to that location.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LocationCubeTable locations={locationRows} />
          {canEditLocations ? <LocationCapacityForm locations={locations} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CubeItemForm({ cubes }: { cubes: ItemCube[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [unitsPerCase, setUnitsPerCase] = useState("1");

  const preview = useMemo(() => {
    const measured = [Number(length), Number(width), Number(height)];
    if (measured.some((value) => !Number.isFinite(value) || value <= 0)) return null;
    try {
      return measureCaseCube(measured[0], measured[1], measured[2]);
    } catch {
      return null;
    }
  }, [length, width, height]);

  function loadCube(cube: ItemCube) {
    setSku(cube.sku);
    setDescription(cube.description);
    setLength(String(cube.lengthInches));
    setWidth(String(cube.widthInches));
    setHeight(String(cube.heightInches));
    setUnitsPerCase(String(cube.unitsPerCase));
    setError(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cube an item</CardTitle>
        <CardDescription>
          Measure the case. Length, width, and height are inches and round up to the
          nearest quarter inch before the cube is saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await saveItemCube({
                sku,
                description,
                lengthInches: Number(length),
                widthInches: Number(width),
                heightInches: Number(height),
                unitsPerCase: Number(unitsPerCase),
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSku("");
              setDescription("");
              setLength("");
              setWidth("");
              setHeight("");
              setUnitsPerCase("1");
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU" htmlFor="cube-sku">
              <Input
                id="cube-sku"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                placeholder="FBR-LC-12-100"
                required
              />
            </Field>
            <Field label="Units in the case" htmlFor="cube-units">
              <Input
                id="cube-units"
                type="number"
                min={1}
                value={unitsPerCase}
                onChange={(event) => setUnitsPerCase(event.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="cube-description">
            <Input
              id="cube-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Length (in)" htmlFor="cube-length">
              <Input
                id="cube-length"
                type="number"
                min={0.01}
                step="0.01"
                value={length}
                onChange={(event) => setLength(event.target.value)}
                required
              />
            </Field>
            <Field label="Width (in)" htmlFor="cube-width">
              <Input
                id="cube-width"
                type="number"
                min={0.01}
                step="0.01"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
                required
              />
            </Field>
            <Field label="Height (in)" htmlFor="cube-height">
              <Input
                id="cube-height"
                type="number"
                min={0.01}
                step="0.01"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                required
              />
            </Field>
          </div>
          {preview ? (
            <p className="text-xs text-muted-foreground">
              Rounded size {formatInches(preview.lengthInches)} × {formatInches(preview.widthInches)} ×{" "}
              {formatInches(preview.heightInches)} · {formatCubicInches(preview.cubicInches)}
            </p>
          ) : null}
          {cubes.length > 0 ? (
            <Field label="Edit an existing cube">
              <NativeSelect
                value=""
                onChange={(event) => {
                  const cube = cubes.find((entry) => entry.sku === event.target.value);
                  if (cube) loadCube(cube);
                }}
              >
                <option value="">Select a SKU</option>
                {cubes.map((cube) => (
                  <option key={cube.sku} value={cube.sku}>
                    {cube.sku}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save cube"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LocationCapacityForm({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const selected = locations.find((location) => location.id === locationId) ?? locations[0];
  const [storageClass, setStorageClass] = useState<StorageClass>(
    selected?.storageClass ?? "rack",
  );
  const [capacity, setCapacity] = useState(
    selected ? String(selected.cubeCapacityCubicInches) : "",
  );

  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateLocationCapacity({
            id: locationId,
            storageClass,
            cubeCapacityCubicInches: Number(capacity),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        });
      }}
    >
      <p className="text-sm font-medium">Update a location cube limit</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Location">
          <NativeSelect
            value={locationId}
            onChange={(event) => {
              const next = locations.find((location) => location.id === event.target.value);
              setLocationId(event.target.value);
              if (!next) return;
              setStorageClass(next.storageClass);
              setCapacity(String(next.cubeCapacityCubicInches));
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Class">
          <NativeSelect
            value={storageClass}
            onChange={(event) => setStorageClass(event.target.value as StorageClass)}
          >
            {STORAGE_CLASSES.map((value) => (
              <option key={value} value={value}>
                {storageClassLabel(value)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Cube capacity (cu in)" htmlFor="location-cube">
          <Input
            id="location-cube"
            type="number"
            min={1}
            step="0.01"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            required
          />
        </Field>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending || !locationId}>
        {pending ? "Saving…" : "Save location capacity"}
      </Button>
    </form>
  );
}

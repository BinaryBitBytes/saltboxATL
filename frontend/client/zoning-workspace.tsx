"use client";

import { T, useT } from "@/frontend/client/language";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { categorizeZoneLines, generateZoneLocations } from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, NativeSelect } from "@/frontend/client/field";
import {
  formatCubicInches,
  storageClassLabel,
  type StorageClass,
} from "@/lib/cubing/measure";
import { STORAGE_CLASSES } from "@/lib/inventory-schema";
import type {
  Aisle,
  Bay,
  Building,
  Division,
  GenerateZoneLocationsInput,
  InventoryItem,
  ItemCube,
  Location,
  ReceivingOrder,
  Site,
  Zone,
} from "@/lib/inventory-schema";
import { planZoneLocations } from "@/lib/locations/zoning";
import {
  CUBE_SIZES,
  PICK_HEIGHTS,
  VELOCITIES,
  ZONE_LETTERS,
  padNumber,
  type CubeSize,
  type PickHeight,
  type Velocity,
} from "@/lib/locations/nomenclature";

export type ZoningLine = {
  id: string;
  sku: string;
  description: string;
  quantity: number;
  locationCode: string;
  roomName: string;
  zoneId: string | null;
};

type Panel = "lines" | "locations";
type Preset = "custom" | "pick-face" | "overhead" | "pick-and-overhead";
type CubeMode = "class" | "measured" | "capacity";
type OverheadSides = "A" | "B" | "both";

const PICK_FACE = {
  includePick: true,
  includeOverhead: false,
  pickHeightFrom: "A" as PickHeight,
  pickHeightTo: "D" as PickHeight,
  pickPositionFrom: "1",
  pickPositionTo: "9",
  overheadFrom: "4",
  overheadTo: "9",
  overheadSides: "both" as OverheadSides,
};

const OVERHEAD = {
  includePick: false,
  includeOverhead: true,
  pickHeightFrom: "A" as PickHeight,
  pickHeightTo: "A" as PickHeight,
  pickPositionFrom: "1",
  pickPositionTo: "1",
  overheadFrom: "4",
  overheadTo: "9",
  overheadSides: "both" as OverheadSides,
};

export function ZoningWorkspace({
  division,
  lines,
  sites,
  buildings,
  zones,
  aisles,
  bays,
  locations,
  inventoryItems,
  receivingOrders,
  itemCubes,
}: {
  division: Division;
  lines: ZoningLine[];
  sites: Site[];
  buildings: Building[];
  zones: Zone[];
  aisles: Aisle[];
  bays: Bay[];
  locations: Location[];
  inventoryItems: InventoryItem[];
  receivingOrders: ReceivingOrder[];
  itemCubes: ItemCube[];
}) {
  const [panel, setPanel] = useState<Panel>("lines");

  return (
    <div className="grid gap-4">
      <Field label="Zoning tab">
        <NativeSelect
          aria-label="Zoning tab"
          value={panel}
          onChange={(event) => setPanel(event.target.value as Panel)}
        >
          <option value="lines">Categorize lines</option>
          <option value="locations">Generate locations</option>
        </NativeSelect>
      </Field>
      {panel === "lines" ? (
        <CategorizePanel lines={lines} zones={zones} sites={sites} buildings={buildings} />
      ) : (
        <GeneratePanel
          division={division}
          sites={sites}
          buildings={buildings}
          zones={zones}
          aisles={aisles}
          bays={bays}
          locations={locations}
          inventoryItems={inventoryItems}
          receivingOrders={receivingOrders}
          itemCubes={itemCubes}
        />
      )}
    </div>
  );
}

function CategorizePanel({
  lines,
  zones,
  sites,
  buildings,
}: {
  lines: ZoningLine[];
  zones: Zone[];
  sites: Site[];
  buildings: Building[];
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [cubeFilter, setCubeFilter] = useState<"any" | (typeof CUBE_SIZES)[number]>("any");
  const [zoneFilter, setZoneFilter] = useState("any");
  const [assignZone, setAssignZone] = useState(zones[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const itemTypes = useMemo(
    () => [...new Set(zones.map((zone) => zone.itemType))].sort((left, right) => left.localeCompare(right)),
    [zones],
  );
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const visible = lines.filter((line) => {
    const zone = line.zoneId ? zoneById.get(line.zoneId) : undefined;
    if (category === "unassigned") return !line.zoneId;
    if (category !== "all" && zone?.itemType !== category) return false;
    if (cubeFilter !== "any" && zone?.cubeSize !== cubeFilter) return false;
    if (zoneFilter !== "any" && line.zoneId !== zoneFilter) return false;
    return true;
  });
  const visibleIds = new Set(visible.map((line) => line.id));
  const selected = selectedIds.filter((id) => visibleIds.has(id));
  const assignValue = assignZone === "" || zones.some((zone) => zone.id === assignZone)
    ? assignZone
    : (zones[0]?.id ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Categorize lines</T>
        </CardTitle>
        <CardDescription>
          <T>
            Use the category, cube size, and zone dropdowns to group inventory lines, then assign the visible selection to a zone.
          </T>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category">
            <NativeSelect
              aria-label="Category"
              value={itemTypes.includes(category) || category === "all" || category === "unassigned" ? category : "all"}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All lines</option>
              <option value="unassigned">Unassigned</option>
              {itemTypes.map((itemType) => (
                <option key={itemType} value={itemType}>
                  {itemType}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Cube size">
            <NativeSelect
              aria-label="Cube size"
              value={cubeFilter}
              onChange={(event) => setCubeFilter(event.target.value as typeof cubeFilter)}
            >
              <option value="any">Any</option>
              {CUBE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Zone">
            <NativeSelect
              aria-label="Zone"
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
            >
              <option value="any">Any</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zoneLabel(zone, buildings, sites)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select visible lines"
                    checked={visible.length > 0 && selected.length === visible.length}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? visible.map((line) => line.id) : [])
                    }
                  />
                </TableHead>
                <TableHead><T>SKU</T></TableHead>
                <TableHead><T>Location</T></TableHead>
                <TableHead><T>Quantity</T></TableHead>
                <TableHead><T>Category</T></TableHead>
                <TableHead><T>Cube size</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    <T>No inventory lines in this category.</T>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((line) => {
                  const zone = line.zoneId ? zoneById.get(line.zoneId) : undefined;
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={line.sku}
                          checked={selected.includes(line.id)}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...current, line.id]
                                : current.filter((id) => id !== line.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{line.sku}</span>
                        <span className="block text-muted-foreground">{line.description}</span>
                      </TableCell>
                      <TableCell className="font-mono">{line.locationCode}</TableCell>
                      <TableCell>{line.quantity}</TableCell>
                      <TableCell>{zone?.itemType ?? t("Unassigned")}</TableCell>
                      <TableCell>{zone?.cubeSize ?? "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setNotice(null);
            startTransition(async () => {
              const result = await categorizeZoneLines({
                inventoryItemIds: selected,
                zoneId: assignValue === "" ? null : assignValue,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSelectedIds([]);
              setNotice(
                t("Updated {{count}} inventory lines.", { count: result.data.updated }),
              );
              router.refresh();
            });
          }}
        >
          <Field label="Assign zone" className="min-w-52">
            <NativeSelect
              aria-label="Assign zone"
              value={assignValue}
              onChange={(event) => setAssignZone(event.target.value)}
            >
              <option value="">Unassigned</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zoneLabel(zone, buildings, sites)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" disabled={pending || selected.length === 0}>
            {pending ? "Saving…" : "Categorize selected"}
          </Button>
        </form>
        {error ? (
          <p className="text-xs text-destructive">
            <T>{error}</T>
          </p>
        ) : null}
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </CardContent>
    </Card>
  );
}

function GeneratePanel({
  division,
  sites,
  buildings,
  zones,
  aisles,
  bays,
  locations,
  inventoryItems,
  receivingOrders,
  itemCubes,
}: {
  division: Division;
  sites: Site[];
  buildings: Building[];
  zones: Zone[];
  aisles: Aisle[];
  bays: Bay[];
  locations: Location[];
  inventoryItems: InventoryItem[];
  receivingOrders: ReceivingOrder[];
  itemCubes: ItemCube[];
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const buildingZones = zones.filter((zone) => zone.buildingId === buildingId);
  const [zoneChoice, setZoneChoice] = useState(buildingZones[0]?.id ?? "new");
  const zoneValue =
    zoneChoice === "new" || buildingZones.some((zone) => zone.id === zoneChoice)
      ? zoneChoice
      : (buildingZones[0]?.id ?? "new");
  const openLetters = ZONE_LETTERS.filter(
    (letter) => !zones.some((zone) => zone.buildingId === buildingId && zone.letter === letter),
  );
  const [letter, setLetter] = useState(openLetters[0] ?? "A");
  const letterValue = openLetters.includes(letter) ? letter : (openLetters[0] ?? "");
  const itemTypes = [...new Set(zones.map((zone) => zone.itemType))];
  const [itemTypeChoice, setItemTypeChoice] = useState(itemTypes[0] ?? "other");
  const [itemType, setItemType] = useState(itemTypes[0] ?? "general");
  const [cubeSize, setCubeSize] = useState<(typeof CUBE_SIZES)[number]>("medium");
  const [projectId, setProjectId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [inboundVelocity, setInboundVelocity] = useState<(typeof VELOCITIES)[number]>("medium");
  const [outboundVelocity, setOutboundVelocity] = useState<(typeof VELOCITIES)[number]>("medium");
  const [aisleFrom, setAisleFrom] = useState("1");
  const [aisleTo, setAisleTo] = useState("1");
  const [bayFrom, setBayFrom] = useState("1");
  const [bayTo, setBayTo] = useState("1");
  const [preset, setPreset] = useState<Preset>("custom");
  const [includePick, setIncludePick] = useState(true);
  const [includeOverhead, setIncludeOverhead] = useState(false);
  const [pickHeightFrom, setPickHeightFrom] = useState<PickHeight>("A");
  const [pickHeightTo, setPickHeightTo] = useState<PickHeight>("A");
  const [pickPositionFrom, setPickPositionFrom] = useState("1");
  const [pickPositionTo, setPickPositionTo] = useState("2");
  const [overheadFrom, setOverheadFrom] = useState("4");
  const [overheadTo, setOverheadTo] = useState("4");
  const [overheadSides, setOverheadSides] = useState<OverheadSides>("both");
  const [storageClass, setStorageClass] = useState<StorageClass>("rack");
  const [cubeMode, setCubeMode] = useState<CubeMode>("class");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [capacity, setCapacity] = useState("");
  const [budget, setBudget] = useState("");

  const input: GenerateZoneLocationsInput = {
    buildingId,
    zoneId: zoneValue === "new" ? undefined : zoneValue,
    letter: zoneValue === "new" ? letterValue : undefined,
    itemType: zoneValue === "new" ? itemType.trim() : undefined,
    cubeSize: zoneValue === "new" ? cubeSize : undefined,
    projectId: zoneValue === "new" ? projectId : undefined,
    poNumber: zoneValue === "new" ? poNumber : undefined,
    inboundVelocity: zoneValue === "new" ? inboundVelocity : undefined,
    outboundVelocity: zoneValue === "new" ? outboundVelocity : undefined,
    aisleFrom: Number(aisleFrom),
    aisleTo: Number(aisleTo),
    bayFrom: Number(bayFrom),
    bayTo: Number(bayTo),
    includePick,
    includeOverhead,
    pickHeightFrom,
    pickHeightTo,
    pickPositionFrom: Number(pickPositionFrom),
    pickPositionTo: Number(pickPositionTo),
    overheadFrom: Number(overheadFrom),
    overheadTo: Number(overheadTo),
    overheadSides,
    storageClass,
    lengthInches: cubeMode === "measured" && length !== "" ? Number(length) : undefined,
    widthInches: cubeMode === "measured" && width !== "" ? Number(width) : undefined,
    heightInches: cubeMode === "measured" && height !== "" ? Number(height) : undefined,
    cubeCapacityCubicInches:
      cubeMode === "capacity" && capacity !== "" ? Number(capacity) : undefined,
    bayCubeBudgetCubicInches: budget === "" ? undefined : Number(budget),
  };

  let preview: { plan: ReturnType<typeof planZoneLocations> | null; error: string | null };
  if (!buildingId) {
    preview = { plan: null, error: "Add a building before generating locations." };
  } else {
    try {
      preview = {
        plan: planZoneLocations(
          {
            sites,
            buildings,
            zones,
            aisles,
            bays,
            locations,
            inventoryItems,
            receivingOrders,
            itemCubes,
          },
          division,
          input,
        ),
        error: null,
      };
    } catch (caught) {
      preview = {
        plan: null,
        error: caught instanceof Error ? caught.message : "Check the location parameters.",
      };
    }
  }

  const fresh = preview.plan?.drafts.filter((draft) => !draft.exists) ?? [];
  const skipped = (preview.plan?.drafts.length ?? 0) - fresh.length;
  const zoneLocations = locations.filter((location) => {
    if (zoneValue === "new") return false;
    const bay = bays.find((entry) => entry.id === location.bayId);
    const aisle = bay ? aisles.find((entry) => entry.id === bay.aisleId) : undefined;
    return aisle?.zoneId === zoneValue;
  });

  function applyPreset(next: Preset) {
    setPreset(next);
    const ranges = next === "pick-face" ? PICK_FACE : next === "overhead" ? OVERHEAD : next === "pick-and-overhead"
      ? { ...PICK_FACE, includeOverhead: true, overheadFrom: "4", overheadTo: "9", overheadSides: "both" as const }
      : null;
    if (!ranges) return;
    setIncludePick(ranges.includePick);
    setIncludeOverhead(ranges.includeOverhead);
    setPickHeightFrom(ranges.pickHeightFrom);
    setPickHeightTo(ranges.pickHeightTo);
    setPickPositionFrom(ranges.pickPositionFrom);
    setPickPositionTo(ranges.pickPositionTo);
    setOverheadFrom(ranges.overheadFrom);
    setOverheadTo(ranges.overheadTo);
    setOverheadSides(ranges.overheadSides);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Generate locations</T>
        </CardTitle>
        <CardDescription>
          <T>
            Submit an aisle and bay range that fits this warehouse. Each new bin uses the cube setting below.
          </T>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setNotice(null);
            if (preview.error || !preview.plan) {
              setError(preview.error ?? "Check the location parameters.");
              return;
            }
            startTransition(async () => {
              const result = await generateZoneLocations(input);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const span =
                result.data.firstCode && result.data.lastCode
                  ? t("Created {{created}} locations from {{first}} through {{last}}.", {
                      created: result.data.created,
                      first: result.data.firstCode,
                      last: result.data.lastCode,
                    })
                  : t("Created {{created}} locations.", { created: result.data.created });
              setNotice(
                `${span} ${t("Skipped {{skipped}} that already existed.", {
                  skipped: result.data.skipped,
                })} ${t("Slot cube is {{cube}}.", {
                  cube: formatCubicInches(result.data.cubeCapacityCubicInches),
                })}`,
              );
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Building">
              <NativeSelect
                value={buildingId}
                onChange={(event) => setBuildingId(event.target.value)}
                disabled={buildings.length === 0}
              >
                {buildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {buildingLabel(building, sites)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Zone">
              <NativeSelect value={zoneValue} onChange={(event) => setZoneChoice(event.target.value)}>
                <option value="new">New zone</option>
                {buildingZones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zoneLabel(zone, buildings, sites)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {zoneValue === "new" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Zone letter">
                <NativeSelect value={letterValue} onChange={(event) => setLetter(event.target.value)}>
                  {openLetters.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Item type">
                <NativeSelect
                  value={itemTypes.includes(itemTypeChoice) ? itemTypeChoice : "other"}
                  onChange={(event) => {
                    const next = event.target.value;
                    setItemTypeChoice(next);
                    if (next !== "other") setItemType(next);
                  }}
                >
                  {itemTypes.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                  <option value="other">Other</option>
                </NativeSelect>
              </Field>
              {itemTypeChoice === "other" || !itemTypes.includes(itemTypeChoice) ? (
                <Field label="New item type">
                  <Input value={itemType} onChange={(event) => setItemType(event.target.value)} />
                </Field>
              ) : null}
              <Field label="Cube size">
                <NativeSelect
                  value={cubeSize}
                  onChange={(event) => setCubeSize(event.target.value as CubeSize)}
                >
                  {CUBE_SIZES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Project ID">
                <Input value={projectId} onChange={(event) => setProjectId(event.target.value)} />
              </Field>
              <Field label="PO number">
                <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} />
              </Field>
              <Field label="Inbound velocity">
                <NativeSelect
                  value={inboundVelocity}
                  onChange={(event) => setInboundVelocity(event.target.value as Velocity)}
                >
                  {VELOCITIES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Outbound velocity">
                <NativeSelect
                  value={outboundVelocity}
                  onChange={(event) => setOutboundVelocity(event.target.value as Velocity)}
                >
                  {VELOCITIES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Aisle from">
              <NumberField value={aisleFrom} onChange={setAisleFrom} max={99} />
            </Field>
            <Field label="Aisle to">
              <NumberField value={aisleTo} onChange={setAisleTo} max={99} />
            </Field>
            <Field label="Bay from">
              <NumberField value={bayFrom} onChange={setBayFrom} max={99} />
            </Field>
            <Field label="Bay to">
              <NumberField value={bayTo} onChange={setBayTo} max={99} />
            </Field>
          </div>

          <Field label="Slot pattern">
            <NativeSelect
              value={preset}
              onChange={(event) => applyPreset(event.target.value as Preset)}
            >
              <option value="custom">Custom</option>
              <option value="pick-face">Pick face</option>
              <option value="overhead">Overhead</option>
              <option value="pick-and-overhead">Pick and overhead</option>
            </NativeSelect>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Pick heights">
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  aria-label="Pick height from"
                  value={pickHeightFrom}
                  onChange={(event) => {
                    setPreset("custom");
                    setPickHeightFrom(event.target.value as PickHeight);
                  }}
                >
                  {PICK_HEIGHTS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Pick height to"
                  value={pickHeightTo}
                  onChange={(event) => {
                    setPreset("custom");
                    setPickHeightTo(event.target.value as PickHeight);
                  }}
                >
                  {PICK_HEIGHTS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </Field>
            <Field label="Pick positions">
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  aria-label="Pick position from"
                  value={pickPositionFrom}
                  onChange={(event) => {
                    setPreset("custom");
                    setPickPositionFrom(event.target.value);
                  }}
                >
                  {positionOptions()}
                </NativeSelect>
                <NativeSelect
                  aria-label="Pick position to"
                  value={pickPositionTo}
                  onChange={(event) => {
                    setPreset("custom");
                    setPickPositionTo(event.target.value);
                  }}
                >
                  {positionOptions()}
                </NativeSelect>
              </div>
            </Field>
            <Field label="Overhead heights">
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  aria-label="Overhead height from"
                  value={overheadFrom}
                  onChange={(event) => {
                    setPreset("custom");
                    setOverheadFrom(event.target.value);
                  }}
                >
                  {overheadOptions()}
                </NativeSelect>
                <NativeSelect
                  aria-label="Overhead height to"
                  value={overheadTo}
                  onChange={(event) => {
                    setPreset("custom");
                    setOverheadTo(event.target.value);
                  }}
                >
                  {overheadOptions()}
                </NativeSelect>
              </div>
            </Field>
            <Field label="Overhead sides">
              <NativeSelect
                value={overheadSides}
                onChange={(event) => {
                  setPreset("custom");
                  setOverheadSides(event.target.value as OverheadSides);
                }}
              >
                <option value="both">A and B</option>
                <option value="A">A left</option>
                <option value="B">B right</option>
              </NativeSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includePick}
              onChange={(event) => {
                setPreset("custom");
                setIncludePick(event.target.checked);
              }}
            />
            <T>Include pick slots</T>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeOverhead}
              onChange={(event) => {
                setPreset("custom");
                setIncludeOverhead(event.target.checked);
              }}
            />
            <T>Include overhead slots</T>
          </label>

          <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">
              <T>Cube setting</T>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Storage class">
                <NativeSelect
                  value={storageClass}
                  onChange={(event) => setStorageClass(event.target.value as StorageClass)}
                >
                  {STORAGE_CLASSES.map((entry) => (
                    <option key={entry} value={entry}>
                      {storageClassLabel(entry)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Cube source">
                <NativeSelect
                  aria-label="Cube source"
                  value={cubeMode}
                  onChange={(event) => setCubeMode(event.target.value as CubeMode)}
                >
                  <option value="class">Class default</option>
                  <option value="measured">Measured case</option>
                  <option value="capacity">Cubic inches</option>
                </NativeSelect>
              </Field>
              {cubeMode === "measured" ? (
                <>
                  <Field label="Length (in)">
                    <Input value={length} onChange={(event) => setLength(event.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="Width (in)">
                    <Input value={width} onChange={(event) => setWidth(event.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="Height (in)">
                    <Input value={height} onChange={(event) => setHeight(event.target.value)} inputMode="decimal" />
                  </Field>
                </>
              ) : null}
              {cubeMode === "capacity" ? (
                <Field label="Cube capacity (cu in)">
                  <Input value={capacity} onChange={(event) => setCapacity(event.target.value)} inputMode="decimal" />
                </Field>
              ) : null}
              <Field label="Bay cube budget (cu in)">
                <Input
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  inputMode="decimal"
                  placeholder="Blank fits the new slots"
                />
              </Field>
            </div>
            {preview.plan ? (
              <p className="text-xs text-muted-foreground">
                {t("{{count}} new locations, {{skipped}} already exist. Slot cube {{cube}}.", {
                  count: fresh.length,
                  skipped,
                  cube: formatCubicInches(preview.plan.cubeCapacityCubicInches),
                })}
              </p>
            ) : null}
          </div>

          {fresh.length > 0 ? (
            <p className="font-mono text-sm">
              {fresh
                .slice(0, 8)
                .map((draft) => draft.code)
                .join(", ")}
              {fresh.length > 8 ? "…" : ""}
            </p>
          ) : null}
          {preview.error ? (
            <p className="text-xs text-destructive">
              <T>{preview.error}</T>
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive">
              <T>{error}</T>
            </p>
          ) : null}
          {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
          <Button type="submit" disabled={pending || buildings.length === 0 || fresh.length === 0}>
            {pending ? "Creating…" : "Create locations"}
          </Button>
        </form>

        {zoneLocations.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><T>Code</T></TableHead>
                  <TableHead><T>Class</T></TableHead>
                  <TableHead><T>Cube capacity</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zoneLocations.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-mono">{location.code}</TableCell>
                    <TableCell>
                      <T>{storageClassLabel(location.storageClass)}</T>
                    </TableCell>
                    <TableCell>{formatCubicInches(location.cubeCapacityCubicInches)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NumberField({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  max: number;
}) {
  return (
    <Input
      type="number"
      min={1}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function positionOptions() {
  return Array.from({ length: 9 }, (_, index) => {
    const value = String(index + 1);
    return (
      <option key={value} value={value}>
        {padNumber(index + 1, 2)}
      </option>
    );
  });
}

function overheadOptions() {
  return ["4", "5", "6", "7", "8", "9"].map((value) => (
    <option key={value} value={value}>
      {padNumber(Number(value), 2)}
    </option>
  ));
}

function buildingLabel(building: Building, sites: Site[]): string {
  const site = sites.find((entry) => entry.id === building.siteId);
  return `${site?.codename ?? "SITE"}-${padNumber(building.number, 3)}`;
}

function zoneLabel(zone: Zone, buildings: Building[], sites: Site[]): string {
  const building = buildings.find((entry) => entry.id === zone.buildingId);
  const prefix = building ? buildingLabel(building, sites) : "BUILDING";
  return `${prefix}-${zone.letter} · ${zone.itemType} · ${zone.cubeSize}`;
}

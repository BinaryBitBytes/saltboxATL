"use client";

import { T } from "@/frontend/client/language";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAisle,
  createBay,
  createBuilding,
  createContainer,
  createLicensePlate,
  createSite,
  createTrailer,
  createZone,
  createLocation,
} from "@/backend/server/serverAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LabelPrintSheet } from "@/frontend/client/label-sheet";
import { buildHandlingLabel } from "@/lib/labels/build-labels";
import {
  CUBE_SIZES,
  formatBinCode,
  formatTrailerCode,
  padNumber,
  unusedCodenames,
  VELOCITIES,
  ZONE_LETTERS,
  type BinAddressInput,
} from "@/lib/locations/nomenclature";
import type {
  Aisle,
  Bay,
  Building,
  Container,
  LicensePlate,
  Location,
  Site,
  Trailer,
  Zone,
} from "@/lib/inventory-schema";

type SaveResult = { ok: true } | { ok: false; error: string };

function useNomenclatureSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(work: () => Promise<SaveResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return { pending, error, save };
}

export function NomenclatureForms({
  sites,
  buildings,
  zones,
  aisles,
  bays,
  trailers,
  licensePlates,
  containers,
  locations,
}: {
  sites: Site[];
  buildings: Building[];
  zones: Zone[];
  aisles: Aisle[];
  bays: Bay[];
  trailers: Trailer[];
  licensePlates: LicensePlate[];
  containers: Container[];
  locations: Location[];
}) {
  const codenames = unusedCodenames(sites.map((site) => site.codename));
  const labels = [
    ...trailers.map((trailer) =>
      buildHandlingLabel({
        id: trailer.id,
        kind: "trailer",
        code: trailer.code,
        detail: trailer.status,
      }),
    ),
    ...licensePlates.map((plate) =>
      buildHandlingLabel({
        id: plate.id,
        kind: "license-plate",
        code: plate.code,
        detail: plate.locationId ? "In a bin" : "On a trailer",
      }),
    ),
    ...containers.map((container) =>
      buildHandlingLabel({
        id: container.id,
        kind: "container",
        code: container.code,
      }),
    ),
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:gap-6 min-[40rem]:grid-cols-2">
        <SiteForm codenames={codenames} />
        <BuildingForm sites={sites} />
        <ZoneForm buildings={buildings} sites={sites} zones={zones} />
        <AisleForm zones={zones} buildings={buildings} sites={sites} />
        <BayForm aisles={aisles} zones={zones} buildings={buildings} sites={sites} />
        <TrailerForm sites={sites} />
        <SlotForm
          sites={sites}
          buildings={buildings}
          zones={zones}
          aisles={aisles}
          bays={bays}
          locations={locations}
        />
        <PlateForm locations={locations} trailers={trailers} />
        <ContainerForm licensePlates={licensePlates} />
      </div>
      {labels.length > 0 ? (
        <LabelPrintSheet
          title="Handling unit labels"
          description="Trailer, license plate, and container barcodes stay separate from the bin address."
          labels={labels}
          printId="handling-labels"
        />
      ) : null}
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-xs text-destructive">
      <T>{error}</T>
    </p>
  );
}

function SiteForm({ codenames }: { codenames: string[] }) {
  const { pending, error, save } = useNomenclatureSave();
  const [codename, setCodename] = useState(codenames[0] ?? "");
  const codenameValue = codenames.includes(codename) ? codename : (codenames[0] ?? "");
  const [state, setState] = useState("GA");
  const [city, setCity] = useState("");
  const [name, setName] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add site</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(
              () => createSite({ codename: codenameValue, state, city, name }),
              () => {
                setCity("");
                setName("");
              },
            );
          }}
        >
          <Field label="Codename">
            <NativeSelect
              value={codenameValue}
              onChange={(event) => setCodename(event.target.value)}
              disabled={codenames.length === 0}
            >
              {codenames.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="State">
            <Input
              value={state}
              maxLength={2}
              onChange={(event) => setState(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label="Site name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || codenames.length === 0}>
            {pending ? "Saving…" : "Add site"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BuildingForm({ sites }: { sites: Site[] }) {
  const { pending, error, save } = useNomenclatureSave();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [number, setNumber] = useState("2");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add building</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() => createBuilding({ siteId, number: Number(number) }));
          }}
        >
          <Field label="Site">
            <NativeSelect value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.codename} · {site.city}, {site.state}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Building number">
            <Input
              type="number"
              min={1}
              max={100}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || sites.length === 0}>
            {pending ? "Saving…" : "Add building"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function buildingLabel(building: Building, sites: Site[]): string {
  const site = sites.find((entry) => entry.id === building.siteId);
  return `${site?.codename ?? "SITE"}-${padNumber(building.number, 3)}`;
}

function ZoneForm({
  buildings,
  sites,
  zones,
}: {
  buildings: Building[];
  sites: Site[];
  zones: Zone[];
}) {
  const { pending, error, save } = useNomenclatureSave();
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? "");
  const openLetters = ZONE_LETTERS.filter(
    (letter) => !zones.some((zone) => zone.buildingId === buildingId && zone.letter === letter),
  );
  const [letter, setLetter] = useState(openLetters[0] ?? "A");
  const letterValue = openLetters.includes(letter) ? letter : (openLetters[0] ?? "");
  const [itemType, setItemType] = useState("general");
  const [cubeSize, setCubeSize] = useState<(typeof CUBE_SIZES)[number]>("medium");
  const [projectId, setProjectId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [inboundVelocity, setInboundVelocity] = useState<(typeof VELOCITIES)[number]>("medium");
  const [outboundVelocity, setOutboundVelocity] = useState<(typeof VELOCITIES)[number]>("medium");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add zone</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() =>
              createZone({
                buildingId,
                letter: letterValue,
                itemType,
                cubeSize,
                projectId,
                poNumber,
                inboundVelocity,
                outboundVelocity,
              }),
            );
          }}
        >
          <Field label="Building">
            <NativeSelect
              value={buildingId}
              onChange={(event) => setBuildingId(event.target.value)}
            >
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {buildingLabel(building, sites)}
                </option>
              ))}
            </NativeSelect>
          </Field>
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
            <Input value={itemType} onChange={(event) => setItemType(event.target.value)} />
          </Field>
          <Field label="Cube size">
            <NativeSelect
              value={cubeSize}
              onChange={(event) => setCubeSize(event.target.value as typeof cubeSize)}
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
              onChange={(event) =>
                setInboundVelocity(event.target.value as typeof inboundVelocity)
              }
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
              onChange={(event) =>
                setOutboundVelocity(event.target.value as typeof outboundVelocity)
              }
            >
              {VELOCITIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || buildings.length === 0 || openLetters.length === 0}>
            {pending ? "Saving…" : "Add zone"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AisleForm({
  zones,
  buildings,
  sites,
}: {
  zones: Zone[];
  buildings: Building[];
  sites: Site[];
}) {
  const { pending, error, save } = useNomenclatureSave();
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [number, setNumber] = useState("1");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add aisle</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() => createAisle({ zoneId, number: Number(number) }));
          }}
        >
          <Field label="Zone">
            <NativeSelect value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
              {zones.map((zone) => {
                const building = buildings.find((entry) => entry.id === zone.buildingId);
                const prefix = building ? buildingLabel(building, sites) : "BUILDING";
                return (
                  <option key={zone.id} value={zone.id}>
                    {prefix}-{zone.letter} · {zone.itemType}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
          <Field label="Aisle number">
            <Input
              type="number"
              min={1}
              max={99}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || zones.length === 0}>
            {pending ? "Saving…" : "Add aisle"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BayForm({
  aisles,
  zones,
  buildings,
  sites,
}: {
  aisles: Aisle[];
  zones: Zone[];
  buildings: Building[];
  sites: Site[];
}) {
  const { pending, error, save } = useNomenclatureSave();
  const [aisleId, setAisleId] = useState(aisles[0]?.id ?? "");
  const [number, setNumber] = useState("1");
  const [budget, setBudget] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add bay</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() =>
              createBay({
                aisleId,
                number: Number(number),
                cubeBudgetCubicInches: budget === "" ? undefined : Number(budget),
              }),
            );
          }}
        >
          <Field label="Aisle">
            <NativeSelect value={aisleId} onChange={(event) => setAisleId(event.target.value)}>
              {aisles.map((aisle) => (
                <option key={aisle.id} value={aisle.id}>
                  {aisleLabel(aisle, zones, buildings, sites)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Bay number">
            <Input
              type="number"
              min={1}
              max={99}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </Field>
          <Field label="Cube budget (cu in)">
            <Input
              type="number"
              min={1}
              placeholder="Blank uses the full face"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || aisles.length === 0}>
            {pending ? "Saving…" : "Add bay"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function firstOpenPosition(locations: Location[], bayId: string, height: string): string {
  const used = new Set(
    locations
      .filter(
        (location) =>
          location.bayId === bayId && location.slotKind === "pick" && location.height === height,
      )
      .map((location) => String(location.position)),
  );
  for (let index = 1; index <= 9; index += 1) {
    if (!used.has(String(index))) return String(index);
  }
  return "1";
}

function SlotForm({
  sites,
  buildings,
  zones,
  aisles,
  bays,
  locations,
}: {
  sites: Site[];
  buildings: Building[];
  zones: Zone[];
  aisles: Aisle[];
  bays: Bay[];
  locations: Location[];
}) {
  const { pending, error, save } = useNomenclatureSave();
  const [bayId, setBayId] = useState(bays[0]?.id ?? "");
  const [slotKind, setSlotKind] = useState<"pick" | "overhead">("pick");
  const [height, setHeight] = useState("A");
  const [position, setPosition] = useState("1");
  const [side, setSide] = useState<"A" | "B">("A");
  const positionValue =
    slotKind === "pick" ? firstOpenPosition(locations, bayId, height) : position;
  const resolvedPosition = slotKind === "pick" && locations.some(
    (location) =>
      location.bayId === bayId &&
      location.slotKind === "pick" &&
      location.height === height &&
      String(location.position) === position,
  )
    ? positionValue
    : position;
  const preview = useMemo(
    () =>
      previewBin({
        sites,
        buildings,
        zones,
        aisles,
        bays,
        bayId,
        slotKind,
        height,
        position: resolvedPosition,
        side,
      }),
    [sites, buildings, zones, aisles, bays, bayId, slotKind, height, resolvedPosition, side],
  );

  return (
    <Card className="min-[40rem]:col-span-2">
      <CardHeader>
        <CardTitle>
          <T>Add bin slot</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() =>
              createLocation(
                slotKind === "pick"
                  ? {
                      bayId,
                      slotKind,
                      height,
                      position: Number(resolvedPosition),
                      storageClass: "rack",
                    }
                  : { bayId, slotKind, height, side, storageClass: "rack" },
              ),
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bay">
              <NativeSelect value={bayId} onChange={(event) => setBayId(event.target.value)}>
                {bays.map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    {bayLabel(bay, aisles, zones, buildings, sites)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Slot kind">
              <NativeSelect
                value={slotKind}
                onChange={(event) => {
                  const next = event.target.value as "pick" | "overhead";
                  setSlotKind(next);
                  setHeight(next === "pick" ? "A" : "04");
                }}
              >
                <option value="pick">Pick path</option>
                <option value="overhead">Overhead</option>
              </NativeSelect>
            </Field>
            {slotKind === "pick" ? (
              <>
                <Field label="Height">
                  <NativeSelect value={height} onChange={(event) => setHeight(event.target.value)}>
                    <option value="A">A low</option>
                    <option value="B">B mid</option>
                    <option value="C">C high</option>
                    <option value="D">D highest</option>
                  </NativeSelect>
                </Field>
                <Field label="Position">
                  <NativeSelect
                    value={resolvedPosition}
                    onChange={(event) => setPosition(event.target.value)}
                  >
                    {Array.from({ length: 9 }, (_, index) => String(index + 1)).map((entry) => (
                      <option key={entry} value={entry}>
                        {padNumber(Number(entry), 2)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            ) : (
              <>
                <Field label="Overhead height">
                  <NativeSelect value={height} onChange={(event) => setHeight(event.target.value)}>
                    {["04", "05", "06", "07", "08", "09"].map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Side">
                  <NativeSelect
                    value={side}
                    onChange={(event) => setSide(event.target.value as "A" | "B")}
                  >
                    <option value="A">A left</option>
                    <option value="B">B right</option>
                  </NativeSelect>
                </Field>
              </>
            )}
          </div>
          <p className="font-mono text-sm">
            {preview.code || "—"}
          </p>
          {preview.error ? (
            <p className="text-xs text-muted-foreground">
              <T>{preview.error}</T>
            </p>
          ) : null}
          <FormError error={error} />
          <Button type="submit" disabled={pending || !preview.code}>
            {pending ? "Saving…" : "Add slot"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TrailerForm({ sites }: { sites: Site[] }) {
  const { pending, error, save } = useNomenclatureSave();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [number, setNumber] = useState("142");
  const [status, setStatus] = useState<"expected" | "arrived" | "departed">("arrived");
  let preview = "";
  try {
    preview = formatTrailerCode(Number(number));
  } catch {
    preview = "";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Check in trailer</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() => createTrailer({ siteId, number: Number(number), status }));
          }}
        >
          <Field label="Site">
            <NativeSelect value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.codename}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Trailer number">
            <Input
              type="number"
              min={1}
              max={999999}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </Field>
          <Field label="Status">
            <NativeSelect
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="expected">expected</option>
              <option value="arrived">arrived</option>
              <option value="departed">departed</option>
            </NativeSelect>
          </Field>
          <p className="font-mono text-sm">{preview || "—"}</p>
          <FormError error={error} />
          <Button type="submit" disabled={pending || sites.length === 0 || !preview}>
            {pending ? "Saving…" : "Check in trailer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PlateForm({
  locations,
  trailers,
}: {
  locations: Location[];
  trailers: Trailer[];
}) {
  const { pending, error, save } = useNomenclatureSave();
  const [place, setPlace] = useState(
    locations[0] ? `location:${locations[0].id}` : trailers[0] ? `trailer:${trailers[0].id}` : "",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add license plate</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const [kind, id] = place.split(":");
            save(() =>
              createLicensePlate(
                kind === "trailer"
                  ? { trailerId: id, locationId: null }
                  : { locationId: id, trailerId: null },
              ),
            );
          }}
        >
          <Field label="Place">
            <NativeSelect value={place} onChange={(event) => setPlace(event.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={`location:${location.id}`}>
                  Bin {location.code}
                </option>
              ))}
              {trailers.map((trailer) => (
                <option key={trailer.id} value={`trailer:${trailer.id}`}>
                  Trailer {trailer.code}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || !place}>
            {pending ? "Saving…" : "Add license plate"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ContainerForm({ licensePlates }: { licensePlates: LicensePlate[] }) {
  const { pending, error, save } = useNomenclatureSave();
  const [licensePlateId, setLicensePlateId] = useState(licensePlates[0]?.id ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Add container</T>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(() => createContainer({ licensePlateId }));
          }}
        >
          <Field label="License plate">
            <NativeSelect
              value={licensePlateId}
              onChange={(event) => setLicensePlateId(event.target.value)}
            >
              {licensePlates.map((plate) => (
                <option key={plate.id} value={plate.id}>
                  {plate.code}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <FormError error={error} />
          <Button type="submit" disabled={pending || licensePlates.length === 0}>
            {pending ? "Saving…" : "Add container"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function aisleLabel(aisle: Aisle, zones: Zone[], buildings: Building[], sites: Site[]): string {
  const zone = zones.find((entry) => entry.id === aisle.zoneId);
  const building = buildings.find((entry) => entry.id === zone?.buildingId);
  const prefix = building ? buildingLabel(building, sites) : "BUILDING";
  return `${prefix}-${zone?.letter ?? "?"}${padNumber(aisle.number, 2)}`;
}

function bayLabel(
  bay: Bay,
  aisles: Aisle[],
  zones: Zone[],
  buildings: Building[],
  sites: Site[],
): string {
  const aisle = aisles.find((entry) => entry.id === bay.aisleId);
  const prefix = aisle ? aisleLabel(aisle, zones, buildings, sites) : "AISLE";
  return `${prefix}-${padNumber(bay.number, 2)}`;
}

function previewBin(input: {
  sites: Site[];
  buildings: Building[];
  zones: Zone[];
  aisles: Aisle[];
  bays: Bay[];
  bayId: string;
  slotKind: "pick" | "overhead";
  height: string;
  position: string;
  side: "A" | "B";
}): { code: string; error: string | null } {
  const bay = input.bays.find((entry) => entry.id === input.bayId);
  const aisle = input.aisles.find((entry) => entry.id === bay?.aisleId);
  const zone = input.zones.find((entry) => entry.id === aisle?.zoneId);
  const building = input.buildings.find((entry) => entry.id === zone?.buildingId);
  const site = input.sites.find((entry) => entry.id === building?.siteId);
  if (!bay || !aisle || !zone || !building || !site) {
    return { code: "", error: "Add a site, building, zone, aisle, and bay first." };
  }
  const slot: BinAddressInput["slot"] =
    input.slotKind === "pick"
      ? { kind: "pick", height: input.height, position: Number(input.position) }
      : { kind: "overhead", height: input.height, side: input.side };
  try {
    return {
      code: formatBinCode({
        codename: site.codename,
        building: building.number,
        zone: zone.letter,
        aisle: aisle.number,
        bay: bay.number,
        slot,
      }),
      error: null,
    };
  } catch (error) {
    return {
      code: "",
      error: error instanceof Error ? error.message : "That slot is not a valid address.",
    };
  }
}

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  allocatePutawayQuantity,
  buildPutawaySlots,
  locationHomeError,
  unitsThatFit,
  type PutawaySlot,
} from "@/lib/cubing/putaway-allocation";
import { isForcedCube } from "@/lib/cubing/forced-cube";
import { buildItemCatalog, itemReportToCsv, queryItemReport } from "@/lib/reports/item-report";
import type { InventoryItem, Location, ReceivingOrder, Room } from "@/lib/inventory-schema";

const HOME = { division: "hyperscale", siteId: "site-alpha" };

function slot(overrides: Partial<PutawaySlot> & Pick<PutawaySlot, "id" | "code">): PutawaySlot {
  return {
    roomId: "room-1",
    storageClass: "rack",
    division: HOME.division,
    siteId: HOME.siteId,
    zoneKey: "A",
    aisleKey: "A-1",
    zoneProjectId: null,
    zoneCubeSize: null,
    slotKind: "pick",
    isActive: true,
    cubeCapacityCubicInches: 1000,
    committedCubicInches: 0,
    occupants: [],
    ...overrides,
  };
}

const primary = slot({
  id: "primary",
  code: "ALPHA-001-A01-01-A01",
  storageClass: "pallet",
  cubeCapacityCubicInches: 1000,
});

const sameAisleShelf = slot({
  id: "shelf-aisle",
  code: "ALPHA-001-A01-02-A01",
  cubeCapacityCubicInches: 400,
});

const sameZoneShelf = slot({
  id: "shelf-zone",
  code: "ALPHA-001-A02-01-A01",
  aisleKey: "A-2",
  cubeCapacityCubicInches: 400,
});

const otherZoneShelf = slot({
  id: "shelf-other-zone",
  code: "ALPHA-001-B01-01-A01",
  zoneKey: "B",
  aisleKey: "B-1",
  cubeCapacityCubicInches: 400,
});

function allocate(overrides: Partial<Parameters<typeof allocatePutawayQuantity>[0]> = {}) {
  return allocatePutawayQuantity({
    quantity: 12,
    cubicInchesPerUnit: 100,
    projectId: "JOB-1",
    poNumber: "PO-1",
    sku: "CASE-SKU",
    batch: null,
    division: HOME.division,
    siteId: HOME.siteId,
    locationId: primary.id,
    locations: [primary, sameAisleShelf, sameZoneShelf, otherZoneShelf],
    ...overrides,
  });
}

describe("putaway cube allocation", () => {
  it("counts only the units that fit in the open cube", () => {
    expect(unitsThatFit(1000, 100)).to.equal(10);
    expect(unitsThatFit(250, 100)).to.equal(2);
    expect(unitsThatFit(50, 100)).to.equal(0);
    expect(unitsThatFit(0, 100)).to.equal(0);
  });

  it("keeps a quantity that fits in the selected location", () => {
    const plan = allocate({ quantity: 8 });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.fits).to.equal(true);
    expect(plan.forced).to.equal(false);
    expect(plan.slices).to.deep.equal([
      {
        locationId: "primary",
        locationCode: primary.code,
        roomId: "room-1",
        quantity: 8,
        cubicInches: 800,
        role: "primary",
      },
    ]);
    expect(plan.verification).to.match(/8 units fit in/i);
  });

  it("fills the location to its cube and puts the remainder on a shelved bin in the same aisle", () => {
    const plan = allocate();
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.fits).to.equal(false);
    expect(plan.slices.map((slice) => [slice.role, slice.locationId, slice.quantity])).to.deep.equal([
      ["primary", "primary", 10],
      ["shelf", "shelf-aisle", 2],
    ]);
    expect(plan.verification).to.match(/shelved bin/i);
    expect(plan.verification).to.include(sameAisleShelf.code);
  });

  it("prefers the same aisle, then the same zone, before another zone", () => {
    const fullAisle = allocate({
      locations: [
        primary,
        { ...sameAisleShelf, committedCubicInches: 400 },
        sameZoneShelf,
        otherZoneShelf,
      ],
    });
    expect(fullAisle.ok).to.equal(true);
    if (!fullAisle.ok) return;
    expect(fullAisle.slices[1]?.locationId).to.equal("shelf-zone");

    const fullZone = allocate({
      locations: [
        primary,
        { ...sameAisleShelf, committedCubicInches: 400 },
        { ...sameZoneShelf, committedCubicInches: 400 },
        otherZoneShelf,
      ],
    });
    expect(fullZone.ok).to.equal(true);
    if (!fullZone.ok) return;
    expect(fullZone.slices[1]?.locationId).to.equal("shelf-other-zone");
  });

  it("does not place a remainder in another division or another site", () => {
    const foreignDivision = slot({
      id: "other-division",
      code: "SIERRA-001-A01-01-A01",
      division: "security",
      cubeCapacityCubicInches: 5000,
    });
    const foreignSite = slot({
      id: "other-site",
      code: "BETA-001-A01-01-A01",
      siteId: "site-beta",
      cubeCapacityCubicInches: 5000,
    });
    const plan = allocate({
      locations: [primary, foreignDivision, foreignSite],
    });
    expect(plan.ok).to.equal(false);
    if (plan.ok) return;
    expect(plan.error).to.match(/will not move them to another division or site/i);

    expect(locationHomeError(foreignDivision, HOME.division, HOME.siteId)).to.match(/another division/i);
    expect(locationHomeError(foreignSite, HOME.division, HOME.siteId)).to.match(/another site/i);
  });

  it("keeps a different project ID off the remainder shelf", () => {
    const occupied = {
      ...sameAisleShelf,
      occupants: [
        {
          sku: "OTHER",
          quantity: 1,
          poNumber: "PO-9",
          jobIdNumber: "JOB-9",
        },
      ],
    };
    const plan = allocate({
      locations: [primary, occupied, sameZoneShelf],
    });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.slices[1]?.locationId).to.equal("shelf-zone");
    expect(plan.slices.some((slice) => slice.locationId === "shelf-aisle")).to.equal(false);
  });

  it("refuses the remainder when every home shelf already holds another project", () => {
    const blocked = (id: string, code: string, aisleKey: string, zoneKey: string) =>
      slot({
        id,
        code,
        aisleKey,
        zoneKey,
        cubeCapacityCubicInches: 5000,
        occupants: [{ sku: "OTHER", quantity: 1, jobIdNumber: "JOB-9" }],
      });
    const plan = allocate({
      locations: [
        primary,
        blocked("shelf-aisle", sameAisleShelf.code, "A-1", "A"),
        blocked("shelf-zone", sameZoneShelf.code, "A-2", "A"),
        slot({
          id: "foreign-open",
          code: "BETA-001-A01-01-A01",
          siteId: "site-beta",
          cubeCapacityCubicInches: 5000,
        }),
      ],
    });
    expect(plan.ok).to.equal(false);
    if (plan.ok) return;
    expect(plan.error).to.match(/project IDs/i);
    expect(plan.error).to.match(/another division or site/i);
  });

  it("does not use a shelf dedicated to another project", () => {
    const plan = allocate({
      locations: [
        primary,
        { ...sameAisleShelf, zoneProjectId: "JOB-9" },
        sameZoneShelf,
      ],
    });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.slices[1]?.locationId).to.equal("shelf-zone");
  });

  it("forces the full quantity into a location that cannot hold it", () => {
    const plan = allocate({ force: true });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.forced).to.equal(true);
    expect(plan.fits).to.equal(false);
    expect(plan.slices).to.have.length(1);
    expect(plan.slices[0]).to.include({
      locationId: "primary",
      quantity: 12,
      role: "forced",
    });
    expect(plan.verification).to.match(/highlighted on reports/i);
    expect(isForcedCube({ cubeForced: true })).to.equal(true);
    expect(isForcedCube({ cubeForced: false })).to.equal(false);
  });

  it("does not let a force override cross divisions, sites, or project IDs", () => {
    const otherDivision = allocate({
      force: true,
      locations: [{ ...primary, division: "security" }, sameAisleShelf],
    });
    expect(otherDivision.ok).to.equal(false);
    if (!otherDivision.ok) expect(otherDivision.error).to.match(/another division/i);

    const otherSite = allocate({
      force: true,
      locations: [{ ...primary, siteId: "site-beta" }, sameAisleShelf],
    });
    expect(otherSite.ok).to.equal(false);
    if (!otherSite.ok) expect(otherSite.error).to.match(/another site/i);

    const otherProject = allocate({
      force: true,
      locations: [
        {
          ...primary,
          occupants: [{ sku: "OTHER", quantity: 1, jobIdNumber: "JOB-9" }],
        },
      ],
    });
    expect(otherProject.ok).to.equal(false);
    if (!otherProject.ok) expect(otherProject.error).to.match(/project/i);
  });

  it("tags slots with division and site so a foreign location cannot be chosen later", () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const homeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const awayId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const homeLocation = {
      id: homeId,
      code: "ALPHA-001-A01-01-A01",
      roomId,
      isActive: true,
      storageClass: "rack",
      cubeCapacityCubicInches: 400,
      division: "hyperscale",
      siteId: "site-alpha",
    } as Location;
    const awayLocation = {
      ...homeLocation,
      id: awayId,
      code: "BETA-001-A01-01-A01",
      division: "security",
      siteId: "site-beta",
    } as Location;
    const slots = buildPutawaySlots({
      locations: [homeLocation, awayLocation],
      items: [],
      orders: [],
      cubes: [],
    });
    expect(slots.find((entry) => entry.id === homeId)).to.include({
      division: "hyperscale",
      siteId: "site-alpha",
    });
    expect(slots.find((entry) => entry.id === awayId)).to.include({
      division: "security",
      siteId: "site-beta",
    });
    const plan = allocatePutawayQuantity({
      quantity: 5,
      cubicInchesPerUnit: 100,
      projectId: "JOB-1",
      sku: "CASE-SKU",
      division: "hyperscale",
      siteId: "site-alpha",
      locationId: homeId,
      locations: slots.map((entry) =>
        entry.id === homeId ? { ...entry, cubeCapacityCubicInches: 200, storageClass: "pallet" } : entry,
      ),
    });
    expect(plan.ok).to.equal(false);
    if (!plan.ok) expect(plan.error).to.match(/another division or site/i);
  });
});

describe("forced cube reporting", () => {
  const room: Room = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fiber Room",
  };
  const bin: Location = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "FIBER-A1",
    roomId: room.id,
    isActive: true,
    storageClass: "rack",
    cubeCapacityCubicInches: 18144,
  };
  const onHand: InventoryItem = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sku: "FBR-LC-12-100",
    upc: "010000000001",
    batch: null,
    locationId: bin.id,
    quantity: 4,
    description: "fiber",
    manufacturer: "",
    color: null,
    fiber: null,
    cubeForced: true,
  };
  const receiving = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    poNumber: "PO-88",
    orderNumber: "RCV-9",
    status: "received",
    pallets: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        palletNumber: "P1",
        cases: [
          {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            sku: "FBR-LC-12-100",
            upc: "010000000001",
            batch: null,
            quantityInCase: 4,
            description: "fiber",
            fiber: null,
            putawayLocationId: bin.id,
            cubeForced: true,
          },
        ],
      },
    ],
  } as ReceivingOrder;

  it("highlights forced cube putaway rows and exports them", () => {
    const catalog = buildItemCatalog({
      inventoryItems: [onHand],
      locations: [bin],
      rooms: [room],
      receivingOrders: [receiving],
      shippingOrders: [],
    });
    const report = queryItemReport(catalog, { sku: "FBR" });
    expect(report.rows.length).to.be.greaterThan(0);
    expect(report.rows.every((row) => row.cubeForced === true)).to.equal(true);
    const csv = itemReportToCsv(report);
    expect(csv).to.include("Forced cube");
    expect(csv).to.include("yes");
  });
});

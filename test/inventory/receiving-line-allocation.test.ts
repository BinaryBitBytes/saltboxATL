import { describe, it } from "mocha";
import { expect } from "chai";
import { CaseItemInputSchema } from "@/lib/inventory-schema";
import { DEFAULT_RACK_CUBE_CUBIC_INCHES } from "@/lib/cubing/measure";
import {
  allocateReceivingLine,
  shelfSlotCube,
  withOpenReceivingReservations,
} from "@/lib/cubing/receiving-line";
import type { PutawaySlot } from "@/lib/cubing/putaway-allocation";

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
    cubeCapacityCubicInches: 400,
    committedCubicInches: 0,
    occupants: [],
    ...overrides,
  };
}

const tightShelf = slot({ id: "shelf-tight", code: "A-01", cubeCapacityCubicInches: 250 });
const wideShelf = slot({ id: "shelf-wide", code: "A-02", cubeCapacityCubicInches: 400 });
const overhead = slot({
  id: "rack-1",
  code: "R-01",
  slotKind: "overhead",
  cubeCapacityCubicInches: 900,
});
const overheadTight = slot({
  id: "rack-tight",
  code: "R-00",
  slotKind: "overhead",
  zoneKey: "B",
  cubeCapacityCubicInches: 600,
});
const projectPallet = slot({
  id: "plt-job",
  code: "PLT-JOB",
  storageClass: "pallet",
  slotKind: null,
  zoneKey: "P",
  zoneCubeSize: "pallet",
  zoneProjectId: "JOB-1",
  cubeCapacityCubicInches: 2000,
});
const sharedPallet = slot({
  id: "plt-shared",
  code: "PLT-SHARED",
  storageClass: "pallet",
  slotKind: null,
  zoneKey: "Q",
  zoneCubeSize: "pallet",
  zoneProjectId: null,
  cubeCapacityCubicInches: 1500,
});
const otherProjectPallet = slot({
  id: "plt-other",
  code: "PLT-OTHER",
  storageClass: "pallet",
  slotKind: null,
  zoneKey: "R",
  zoneCubeSize: "pallet",
  zoneProjectId: "JOB-9",
  cubeCapacityCubicInches: 5000,
});
const foreignShelf = slot({
  id: "other-division",
  code: "SEC-01",
  division: "security",
  cubeCapacityCubicInches: 5000,
});

const locations = [
  tightShelf,
  wideShelf,
  overhead,
  overheadTight,
  projectPallet,
  sharedPallet,
  otherProjectPallet,
  foreignShelf,
];

function allocate(overrides: Partial<Parameters<typeof allocateReceivingLine>[0]> = {}) {
  return allocateReceivingLine({
    quantity: 2,
    cubicInchesPerUnit: 100,
    fullPallet: false,
    projectId: "JOB-1",
    poNumber: "PO-1",
    sku: "CASE-SKU",
    batch: null,
    division: HOME.division,
    siteId: HOME.siteId,
    locations,
    ...overrides,
  });
}

describe("receiving line shelf prompt", () => {
  it("uses the largest shelf slot and ignores overhead and pallet locations", () => {
    expect(shelfSlotCube(locations, HOME)).to.equal(400);
    expect(shelfSlotCube(locations)).to.equal(5000);
    expect(shelfSlotCube([])).to.equal(DEFAULT_RACK_CUBE_CUBIC_INCHES);
    expect(
      shelfSlotCube([
        { ...overhead, isActive: true },
        { ...projectPallet, isActive: true },
      ]),
    ).to.equal(DEFAULT_RACK_CUBE_CUBIC_INCHES);
  });

  it("treats a line that exactly fills the largest shelf as a shelf slot", () => {
    const plan = allocate({ quantity: 4 });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.exceedsShelf).to.equal(false);
    expect(plan.fullPallet).to.equal(null);
    expect(plan.slices[0]?.locationId).to.equal("shelf-wide");
  });

  it("directs a line that fits a shelf to the tightest open shelf", () => {
    const plan = allocate();
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.exceedsShelf).to.equal(false);
    expect(plan.fullPallet).to.equal(null);
    expect(plan.route).to.equal("shelf");
    expect(plan.slices.map((slice) => slice.locationId)).to.deep.equal(["shelf-tight"]);
    expect(plan.verification).to.match(/shelf slot A-01/i);
  });

  it("asks for a full pallet only by routing a larger line to the project pallet zone", () => {
    const plan = allocate({ quantity: 5, fullPallet: true });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.exceedsShelf).to.equal(true);
    expect(plan.fullPallet).to.equal(true);
    expect(plan.route).to.equal("pallet");
    expect(plan.slices).to.deep.equal([
      {
        locationId: "plt-job",
        locationCode: "PLT-JOB",
        roomId: "room-1",
        quantity: 5,
        cubicInches: 500,
        role: "primary",
      },
    ]);
    expect(plan.verification).to.match(/full pallet of CASE-SKU directed to PLT-JOB/i);
  });

  it("keeps a full pallet in one location and will not use another project's zone", () => {
    const spilled = allocate({
      quantity: 18,
      fullPallet: true,
      locations: [
        wideShelf,
        { ...projectPallet, cubeCapacityCubicInches: 1000 },
        { ...sharedPallet, cubeCapacityCubicInches: 2500 },
        otherProjectPallet,
      ],
    });
    expect(spilled.ok).to.equal(true);
    if (!spilled.ok) return;
    expect(spilled.slices[0]?.locationId).to.equal("plt-shared");

    const blocked = allocate({
      quantity: 30,
      fullPallet: true,
      locations: [tightShelf, wideShelf, otherProjectPallet],
    });
    expect(blocked.ok).to.equal(false);
    if (blocked.ok) return;
    expect(blocked.error).to.match(/full pallet zone/i);
  });

  it("puts an oversized line that is not a full pallet into a rack slot", () => {
    const plan = allocate({ quantity: 5, fullPallet: false });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.exceedsShelf).to.equal(true);
    expect(plan.fullPallet).to.equal(false);
    expect(plan.route).to.equal("rack");
    expect(plan.slices.map((slice) => slice.locationId)).to.deep.equal(["rack-tight"]);
    expect(plan.slices.some((slice) => slice.locationId.startsWith("shelf"))).to.equal(false);
    expect(plan.verification).to.match(/rack slot R-00/i);
  });

  it("splits a non-pallet line across rack slots when one opening is too small", () => {
    const plan = allocate({
      quantity: 12,
      fullPallet: false,
      locations: [wideShelf, overhead, overheadTight],
    });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.slices.map((slice) => [slice.locationId, slice.quantity])).to.deep.equal([
      ["rack-tight", 6],
      ["rack-1", 6],
    ]);
    expect(plan.verification).to.match(/rack slots/i);
  });

  it("does not put the line in another division", () => {
    const plan = allocate({
      quantity: 2,
      locations: [foreignShelf],
    });
    expect(plan.ok).to.equal(false);
    if (plan.ok) return;
    expect(plan.error).to.match(/shelf slot/i);
  });

  it("leaves an uncubed line undirected", () => {
    const plan = allocate({ cubicInchesPerUnit: 0, fullPallet: true });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.directed).to.equal(false);
    expect(plan.slices).to.deep.equal([]);
    expect(plan.verification).to.match(/Cubing tab/i);
  });

  it("reserves cube already directed on an open receipt", () => {
    const reserved = withOpenReceivingReservations([tightShelf, wideShelf], {
      cubes: [{ sku: "CASE-SKU", cubicInches: 100, unitsPerCase: 1 }],
      purchaseOrders: [{ purchaseOrderNumber: "PO-1", jobIdNumber: "JOB-1" }],
      orders: [
        {
          status: "in-progress",
          poNumber: "PO-1",
          pallets: [
            {
              cases: [
                {
                  id: "case-1",
                  sku: "CASE-SKU",
                  quantityInCase: 2,
                  putawayLocationId: "shelf-tight",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(reserved.find((entry) => entry.id === "shelf-tight")?.committedCubicInches).to.equal(200);

    const plan = allocate({ locations: reserved, quantity: 2 });
    expect(plan.ok).to.equal(true);
    if (!plan.ok) return;
    expect(plan.slices[0]?.locationId).to.equal("shelf-wide");
  });

  it("defaults the full pallet checkbox to unchecked", () => {
    const parsed = CaseItemInputSchema.parse({
      description: "Case",
      quantityInCase: 1,
      generateSku: true,
      generateUpc: true,
    });
    expect(parsed.fullPallet).to.equal(false);
    const checked = CaseItemInputSchema.parse({
      description: "Case",
      quantityInCase: 1,
      generateSku: true,
      generateUpc: true,
      fullPallet: true,
    });
    expect(checked.fullPallet).to.equal(true);
  });
});

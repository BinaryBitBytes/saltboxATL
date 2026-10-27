import { describe, it } from "mocha";
import { expect } from "chai";
import { applyInventoryMove } from "@/lib/inventory/move";
import {
  binMixError,
  cartonsForQuantity,
  checkBinPlacement,
  nearestOpenLocation,
  sharesPurchaseOrderOrJob,
  splitIntoCartonQuantities,
  takeCartons,
  type BinOccupant,
  type PlacementLocation,
} from "@/lib/inventory/bin-container";
import { ValidationError } from "@/lib/validation/errors";
import { makeItem, makeLocation } from "../helpers";

const now = "2026-10-26T16:00:00.000Z";

function occupant(overrides: Partial<BinOccupant> & Pick<BinOccupant, "sku">): BinOccupant {
  return {
    quantity: 1,
    batch: null,
    poNumber: null,
    jobIdNumber: null,
    ...overrides,
  };
}

function slot(
  id: string,
  code: string,
  capacity: number,
  committed = 0,
): PlacementLocation {
  return {
    id,
    code,
    isActive: true,
    storageClass: "rack",
    division: "hyperscale",
    cubeCapacityCubicInches: capacity,
    committedCubicInches: committed,
  };
}

describe("bin container rules", () => {
  it("lets separate items share a bin when they use the same PO or the same job ID", () => {
    expect(
      sharesPurchaseOrderOrJob(
        { poNumber: "PO-1", jobIdNumber: "J-9" },
        { poNumber: "PO-2", jobIdNumber: "J-9" },
      ),
    ).to.equal(true);
    expect(
      sharesPurchaseOrderOrJob({ poNumber: "PO-1" }, { poNumber: "po-1", jobIdNumber: "OTHER" }),
    ).to.equal(true);
    const occupants = [
      occupant({ sku: "SKU-A", poNumber: "PO-1", jobIdNumber: "J-1" }),
      occupant({ sku: "SKU-B", poNumber: "PO-2", jobIdNumber: "J-1" }),
    ];
    expect(
      binMixError(
        occupant({ sku: "SKU-C", poNumber: "PO-3", jobIdNumber: "J-1" }),
        occupants,
        "A-01-01",
      ),
    ).to.equal(null);
    expect(
      binMixError(occupant({ sku: "SKU-C", poNumber: "PO-1" }), occupants, "A-01-01"),
    ).to.include("same PO number or the same job ID");
  });

  it("rejects a mix that does not share a PO or job, including untagged freight", () => {
    const message = binMixError(
      occupant({ sku: "SKU-B" }),
      [occupant({ sku: "SKU-A", poNumber: "PO-1" })],
      "A-01-01",
    );
    expect(message).to.include("A-01-01");
    expect(message).to.include("PO number or job ID");
    expect(
      binMixError(
        occupant({ sku: "SKU-A", quantity: 4 }),
        [occupant({ sku: "SKU-A", quantity: 6 })],
        "A-01-01",
      ),
    ).to.equal(null);
  });

  it("gives every carton of a SKU its own license plate", () => {
    expect(splitIntoCartonQuantities(25, 12)).to.deep.equal([12, 12, 1]);
    const plates = ["00000001", "00000002", "00000003"];
    let index = 0;
    const cartons = cartonsForQuantity(25, 12, "00000010", () => plates[index++] ?? "00000099");
    expect(cartons.map((carton) => carton.licensePlateNumber)).to.deep.equal([
      "00000010",
      "00000001",
      "00000002",
    ]);
    expect(new Set(cartons.map((carton) => carton.licensePlateNumber)).size).to.equal(3);
    expect(cartons.reduce((sum, carton) => sum + carton.quantity, 0)).to.equal(25);
  });

  it("keeps a whole carton's plate and issues a new plate only for a split piece", () => {
    const { kept, moved } = takeCartons(
      [
        { licensePlateNumber: "00000010", quantity: 12 },
        { licensePlateNumber: "00000011", quantity: 12 },
      ],
      18,
      12,
      () => "00000012",
    );
    expect(moved.map((carton) => carton.licensePlateNumber)).to.deep.equal([
      "00000010",
      "00000012",
    ]);
    expect(kept).to.deep.equal([{ licensePlateNumber: "00000011", quantity: 6 }]);
  });

  it("refuses a bin whose cube cannot hold the cartons and names the nearest open slot", () => {
    const origin = slot("bin-a", "ALPHA-001-A03-12-A01", 100, 80);
    const nearer = slot("bin-b", "ALPHA-001-A03-12-A02", 100, 0);
    const farther = slot("bin-c", "ALPHA-001-A03-14-A01", 500, 0);
    const full = slot("bin-d", "ALPHA-001-A03-12-A03", 100, 100);
    const incoming = occupant({ sku: "SKU-A", poNumber: "PO-1" });
    const occupants = new Map([
      ["bin-a", [occupant({ sku: "SKU-B", poNumber: "PO-1", quantity: 1 })]],
    ]);
    const result = checkBinPlacement({
      location: origin,
      occupants: occupants.get("bin-a") ?? [],
      incoming,
      incomingCubicInches: 40,
      locations: [origin, nearer, farther, full],
      occupantsByLocation: occupants,
    });
    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.message).to.include("too large for the slot");
    expect(result.message).to.include("Nearest open location is ALPHA-001-A03-12-A02.");
    expect(result.suggestion).to.deep.equal({
      id: "bin-b",
      code: "ALPHA-001-A03-12-A02",
    });
    expect(
      nearestOpenLocation({
        origin,
        incoming,
        incomingCubicInches: 40,
        locations: [origin, full],
        occupantsByLocation: occupants,
      }),
    ).to.equal(null);
  });

  it("does not move freight that breaks the bin rules", () => {
    const source = makeLocation({ code: "A-01-01", division: "hyperscale" });
    const destination = makeLocation({
      code: "A-01-02",
      division: "hyperscale",
      cubeCapacityCubicInches: 1_000,
    });
    const moving = makeItem({
      locationId: source.id,
      sku: "SKU-B",
      quantity: 2,
      poNumber: "PO-2",
      division: "hyperscale",
    });
    const resident = makeItem({
      locationId: destination.id,
      sku: "SKU-A",
      quantity: 2,
      poNumber: "PO-1",
      division: "hyperscale",
    });
    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [moving, resident],
          locations: [source, destination],
          itemCubes: [
            {
              sku: "SKU-B",
              description: "B",
              lengthInches: 10,
              widthInches: 10,
              heightInches: 10,
              cubicInches: 1_000,
              unitsPerCase: 1,
              cubedAt: now,
            },
          ],
        },
        {
          inventoryItemId: moving.id,
          destinationLocationId: destination.id,
          quantity: 1,
          confirmLargeInput: false,
        },
        now,
      ),
    ).to.throw(ValidationError, /same PO number or the same job ID/);

    const open = makeLocation({
      code: "ALPHA-001-A03-12-A02",
      division: "hyperscale",
      cubeCapacityCubicInches: 5_000,
    });
    const tight = makeLocation({
      code: "ALPHA-001-A03-12-A01",
      division: "hyperscale",
      cubeCapacityCubicInches: 100,
    });
    const carton = makeItem({
      locationId: source.id,
      sku: "SKU-C",
      quantity: 2,
      poNumber: "PO-9",
      jobIdNumber: "JOB-1",
      division: "hyperscale",
    });
    expect(() =>
      applyInventoryMove(
        {
          inventoryItems: [carton],
          locations: [source, tight, open],
          itemCubes: [
            {
              sku: "SKU-C",
              description: "C",
              lengthInches: 10,
              widthInches: 10,
              heightInches: 5,
              cubicInches: 500,
              unitsPerCase: 1,
              cubedAt: now,
            },
          ],
        },
        {
          inventoryItemId: carton.id,
          destinationLocationId: tight.id,
          quantity: 1,
          confirmLargeInput: false,
        },
        now,
      ),
    ).to.throw(ValidationError, /Nearest open location is ALPHA-001-A03-12-A02/);
  });

  it("moves each carton onto the destination with its own license plate", () => {
    const source = makeLocation({ code: "A-01-01", division: "hyperscale" });
    const destination = makeLocation({ code: "A-01-02", division: "hyperscale" });
    const item = makeItem({
      locationId: source.id,
      quantity: 24,
      poNumber: "PO-9",
      jobIdNumber: "JOB-1",
      licensePlateNumber: "00000010",
      cartons: [
        { licensePlateNumber: "00000010", quantity: 12 },
        { licensePlateNumber: "00000011", quantity: 12 },
      ],
      division: "hyperscale",
    });
    const moved = applyInventoryMove(
      { inventoryItems: [item], locations: [source, destination] },
      {
        inventoryItemId: item.id,
        destinationLocationId: destination.id,
        quantity: 24,
        confirmLargeInput: false,
      },
      now,
    );
    const arrived = moved.items.find((entry) => entry.locationId === destination.id);
    expect(arrived?.cartons?.map((carton) => carton.licensePlateNumber)).to.deep.equal([
      "00000010",
      "00000011",
    ]);
    expect(moved.items.find((entry) => entry.id === item.id)?.licensePlateNumber ?? null).to.equal(
      null,
    );
  });
});

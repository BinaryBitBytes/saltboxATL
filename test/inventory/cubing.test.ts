import { describe, it } from "mocha";
import { expect } from "chai";
import {
  caseCubicInches,
  measureCaseCube,
  roundUpToQuarterInch,
} from "@/lib/cubing/measure";
import {
  cubingWorkflow,
  inventoryQuantityCubeMessage,
  type CubingLocation,
} from "@/lib/cubing/workflow";

const palletLocation = (overrides: Partial<CubingLocation> = {}): CubingLocation => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "PLT-01",
  storageClass: "pallet",
  cubeCapacityCubicInches: 1000,
  isActive: true,
  committedCubicInches: 0,
  ...overrides,
});

const rackLocation = (overrides: Partial<CubingLocation> = {}): CubingLocation => ({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  code: "A-01-01",
  storageClass: "rack",
  cubeCapacityCubicInches: 400,
  isActive: true,
  committedCubicInches: 0,
  ...overrides,
});

function cases(count: number, cube = 100) {
  return Array.from({ length: count }, (_, index) => ({
    id: `case-${index + 1}`,
    sku: "CASE-SKU",
    quantity: 1,
    cube,
  }));
}

describe("case cubing measurements", () => {
  it("rounds each side up to the nearest quarter inch", () => {
    expect(roundUpToQuarterInch(10)).to.equal(10);
    expect(roundUpToQuarterInch(10.01)).to.equal(10.25);
    expect(roundUpToQuarterInch(10.25)).to.equal(10.25);
    expect(roundUpToQuarterInch(10.26)).to.equal(10.5);
    expect(roundUpToQuarterInch(0.1)).to.equal(0.25);
    expect(() => roundUpToQuarterInch(0)).to.throw(/positive/i);
    expect(() => roundUpToQuarterInch(-2)).to.throw(/positive/i);
  });

  it("stores the case cube from the rounded sides", () => {
    const measured = measureCaseCube(10.01, 8, 6.26);
    expect(measured).to.deep.equal({
      lengthInches: 10.25,
      widthInches: 8,
      heightInches: 6.5,
      cubicInches: 533.0,
    });
  });

  it("uses one case of cube when the line quantity matches units per case", () => {
    expect(caseCubicInches(12, { cubicInches: 480, unitsPerCase: 12 })).to.equal(480);
    expect(caseCubicInches(6, { cubicInches: 480, unitsPerCase: 12 })).to.equal(240);
  });
});

describe("cubing workflow for receiving and inventory", () => {
  const cubes = [{ sku: "CASE-SKU", cubicInches: 100, unitsPerCase: 1 }];
  const locations = [palletLocation(), rackLocation()];

  it("keeps a pallet together when it is within the full pallet cube limit", () => {
    const plan = cubingWorkflow({
      cases: cases(8),
      cubes,
      locations,
    });
    expect(plan.status).to.equal("fits");
    expect(plan.loads).to.have.length(1);
    expect(plan.loads[0]?.route).to.equal("pallet");
    expect(plan.loads[0]?.caseCount).to.equal(8);
    expect(plan.loads[0]?.locationCode).to.equal("PLT-01");
    expect(plan.directive).to.match(/keep the pallet together/i);
  });

  it("breaks an oversized pallet down and routes a small remainder to a rack", () => {
    const plan = cubingWorkflow({
      cases: cases(12),
      cubes,
      locations,
    });
    expect(plan.status).to.equal("break-down");
    expect(plan.palletCubeLimit).to.equal(1000);
    expect(plan.loads[0]).to.include({
      route: "pallet",
      caseCount: 10,
      cubicInches: 1000,
      locationCode: "PLT-01",
    });
    expect(plan.loads[1]).to.include({
      route: "rack",
      caseCount: 2,
      cubicInches: 200,
      locationCode: "A-01-01",
    });
    expect(plan.directive).to.match(/break the pallet down to 10 cases/i);
    expect(plan.directive).to.match(/racked location/i);
  });

  it("routes a remainder that is too large for a rack to another full pallet location", () => {
    const plan = cubingWorkflow({
      cases: cases(15),
      cubes,
      locations: [
        palletLocation(),
        palletLocation({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          code: "PLT-02",
        }),
        rackLocation(),
      ],
    });
    expect(plan.status).to.equal("break-down");
    expect(plan.loads[1]).to.include({
      route: "pallet",
      caseCount: 5,
      cubicInches: 500,
    });
    expect(plan.loads[1]?.locationCode).to.equal("PLT-02");
    expect(plan.directive).to.match(/full pallet location \(PLT-02\)/i);
  });

  it("splits a pallet into successive pallet loads and a final rack remainder", () => {
    const plan = cubingWorkflow({
      cases: cases(24),
      cubes,
      locations: [
        palletLocation(),
        palletLocation({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          code: "PLT-02",
        }),
        rackLocation(),
      ],
    });
    expect(plan.loads.map((load) => [load.route, load.caseCount])).to.deep.equal([
      ["pallet", 10],
      ["pallet", 10],
      ["rack", 4],
    ]);
  });

  it("does not direct a case that is larger than every full pallet location", () => {
    const plan = cubingWorkflow({
      cases: [{ id: "case-1", sku: "CASE-SKU", quantity: 1 }],
      cubes: [{ sku: "CASE-SKU", cubicInches: 1500, unitsPerCase: 1 }],
      locations,
    });
    expect(plan.status).to.equal("case-too-large");
    expect(plan.loads).to.deep.equal([]);
    expect(plan.directive).to.match(/cannot be directed/i);
  });

  it("stops directing a pallet until every SKU has a cube", () => {
    const plan = cubingWorkflow({
      cases: cases(2),
      cubes: [],
      locations,
    });
    expect(plan.status).to.equal("missing-cube");
    expect(plan.missingSkus).to.deep.equal(["CASE-SKU"]);
    expect(plan.directive).to.match(/Cubing tab/i);
  });

  it("suggests a tighter open location and will not reuse cube that was already assigned", () => {
    const plan = cubingWorkflow({
      cases: cases(8),
      cubes,
      locations: [
        palletLocation({ committedCubicInches: 200 }),
        palletLocation({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          code: "PLT-02",
          cubeCapacityCubicInches: 5000,
        }),
        rackLocation(),
      ],
    });
    expect(plan.loads[0]?.locationCode).to.equal("PLT-01");
  });

  it("rejects an inventory quantity that would overflow the location cube", () => {
    const cube = { sku: "CASE-SKU", cubicInches: 100, unitsPerCase: 1 };
    expect(
      inventoryQuantityCubeMessage({
        sku: "CASE-SKU",
        locationCode: "A-01-01",
        capacity: 1000,
        committedCubicInches: 800,
        cube,
        quantityBefore: 2,
        quantityAfter: 4,
      }),
    ).to.equal(null);

    const blocked = inventoryQuantityCubeMessage({
      sku: "CASE-SKU",
      locationCode: "A-01-01",
      capacity: 1000,
      committedCubicInches: 800,
      cube,
      quantityBefore: 2,
      quantityAfter: 9,
    });
    expect(blocked).to.match(/too large for the location/i);
    expect(blocked).to.match(/4 more units/i);
  });
});

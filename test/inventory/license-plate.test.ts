import { describe, it } from "mocha";
import { expect } from "chai";
import { lookupInventory } from "@/backend/server/inventory-service";
import { applyInventoryMove } from "@/lib/inventory/move";
import { InventorySystemSchema, type InventorySystem, type ReceivingOrder } from "@/lib/inventory-schema";
import { mergeDivision, scopeSystem } from "@/lib/divisions";
import { inventoryRowsToSpreadsheet } from "@/lib/inventory/spreadsheet";
import {
  allocateLicensePlate,
  currentEntryUsers,
  stampInventoryLines,
} from "@/lib/license-plate/assign";
import { indexLicensePlates, queryLicensePlate } from "@/lib/license-plate/query";
import {
  bufferDepth,
  createLicensePlateGate,
  emptyLedger,
  fillBuffers,
  formatPlateNumber,
  issuePlate,
  LICENSE_PLATE_MAX,
  LICENSE_PLATE_POOL_USER,
  ordinalForPlateValue,
  plateValueAtOrdinal,
  zigzagMerge,
} from "@/lib/license-plate/sequence";
import {
  buildHandlingLabel,
  buildInboundLabels,
  buildOutboundLabels,
  licensePlateTag,
} from "@/lib/labels/build-labels";
import { addLicensePlate } from "@/lib/locations/hierarchy";
import { parseScanCode } from "@/lib/scan-code";
import { makeItem, makeLocation } from "../helpers";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseSystem(overrides: Partial<InventorySystem> = {}): InventorySystem {
  return {
    ...InventorySystemSchema.parse({}),
    rooms: [{ id: ROOM_ID, name: "Dock", division: "hyperscale" }],
    locations: [makeLocation({ id: LOCATION_ID, roomId: ROOM_ID, division: "hyperscale" })],
    ...overrides,
  };
}

describe("license plate sequence", () => {
  it("reorders the consecutive list with a zigzag merge", () => {
    const span = 10;
    const consecutive = Array.from({ length: span }, (_, value) => value);
    const merged = zigzagMerge(consecutive);
    expect(merged).to.deep.equal([0, 9, 1, 8, 2, 7, 3, 6, 4, 5]);
    merged.forEach((value, ordinal) => {
      expect(plateValueAtOrdinal(ordinal, span - 1)).to.equal(value);
      expect(ordinalForPlateValue(value, span - 1)).to.equal(ordinal);
    });
    expect(plateValueAtOrdinal(0)).to.equal(0);
    expect(plateValueAtOrdinal(1)).to.equal(LICENSE_PLATE_MAX);
    expect(plateValueAtOrdinal(2)).to.equal(1);
    expect(plateValueAtOrdinal(LICENSE_PLATE_MAX)).to.equal(50_000_000);
    expect(formatPlateNumber(0)).to.equal("00000000");
    expect(formatPlateNumber(LICENSE_PLATE_MAX)).to.equal("99999999");
  });

  it("keeps the first 20,000 zigzag values unique and inside the 8-digit range", () => {
    const seen = new Set<number>();
    for (let ordinal = 0; ordinal < 20_000; ordinal += 1) {
      const value = plateValueAtOrdinal(ordinal);
      expect(value).to.be.at.least(0);
      expect(value).to.be.at.most(LICENSE_PLATE_MAX);
      expect(seen.has(value)).to.equal(false);
      seen.add(value);
      expect(ordinalForPlateValue(value)).to.equal(ordinal);
    }
  });

  it("sizes each user's buffer to the number of active users and deals it in a zigzag", () => {
    expect(bufferDepth(1)).to.equal(1);
    expect(bufferDepth(4)).to.equal(4);
    const ledger = emptyLedger();
    const users = ["ann", "bo", "cy"];
    fillBuffers(ledger, users);
    expect(ledger.activeUsers).to.deep.equal(users);
    const byUser = new Map(ledger.reservations.map((entry) => [entry.userId, entry.plates]));
    expect(byUser.get("ann")?.map(formatPlateNumber)).to.deep.equal([
      "00000000",
      "99999997",
      "00000003",
    ]);
    expect(byUser.get("bo")?.map(formatPlateNumber)).to.deep.equal([
      "99999999",
      "00000002",
      "99999996",
    ]);
    expect(byUser.get("cy")?.map(formatPlateNumber)).to.deep.equal([
      "00000001",
      "99999998",
      "00000004",
    ]);
    const reserved = [...byUser.values()].flat();
    expect(new Set(reserved).size).to.equal(reserved.length);
    expect(reserved).to.have.length(bufferDepth(users.length) * users.length);
  });

  it("does not hand one user plates reserved for someone else", () => {
    const ledger = emptyLedger();
    const users = ["ann", "bo", "cy"];
    fillBuffers(ledger, users);
    const heldByOthers = new Set(
      ledger.reservations
        .filter((entry) => entry.userId !== "ann")
        .flatMap((entry) => entry.plates),
    );
    const issued: number[] = [];
    for (let count = 0; count < 5; count += 1) {
      issued.push(issuePlate(ledger, "ann", users));
    }
    for (const value of issued) {
      expect(heldByOthers.has(value)).to.equal(false);
      expect(formatPlateNumber(value)).to.match(/^\d{8}$/);
    }
    expect(new Set(issued).size).to.equal(issued.length);
  });

  it("returns a departed user's unissued plates to the pool before taking new numbers", () => {
    const ledger = emptyLedger();
    fillBuffers(ledger, ["ann", "bo"]);
    const boPlates = [
      ...(ledger.reservations.find((entry) => entry.userId === "bo")?.plates ?? []),
    ];
    const cursor = ledger.nextOrdinal;
    fillBuffers(ledger, ["ann"]);
    expect(
      ledger.reservations.find((entry) => entry.userId === LICENSE_PLATE_POOL_USER)?.plates,
    ).to.deep.equal(boPlates);
    expect(issuePlate(ledger, "ann", ["ann"])).to.equal(0);
    expect(issuePlate(ledger, "ann", ["ann"])).to.equal(99_999_998);
    expect(ledger.nextOrdinal).to.equal(cursor);
    expect(ledger.reservations.find((entry) => entry.userId === "ann")?.plates).to.include(
      boPlates[0],
    );
  });
});

describe("simultaneous license plate users", () => {
  it("serializes overlapping assignments so every plate is unique", async () => {
    let inside = 0;
    let maxInside = 0;
    const users = ["ann", "bo", "cy", "dee"];
    const gate = createLicensePlateGate(emptyLedger(), {
      afterReserve: async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inside -= 1;
      },
    });

    const issued = await Promise.all(
      Array.from({ length: 40 }, (_, index) => gate.issue(users[index % users.length]!, users)),
    );
    const numbers = issued.map((plate) => plate.number);
    expect(maxInside).to.equal(1);
    expect(new Set(numbers).size).to.equal(numbers.length);
    for (const number of numbers) expect(number).to.match(/^\d{8}$/);

    const snapshot = gate.snapshot();
    const reserved = snapshot.reservations.flatMap((entry) => entry.plates);
    const claimed = new Set<number>([...reserved, ...issued.map((plate) => plate.value)]);
    expect(claimed.size).to.equal(snapshot.nextOrdinal);
    for (let ordinal = 0; ordinal < snapshot.nextOrdinal; ordinal += 1) {
      expect(claimed.has(plateValueAtOrdinal(ordinal))).to.equal(true);
    }
  });

  it("shows an unlocked read/write gap can duplicate a number, and the gate does not", async () => {
    const shared = { next: 0 };
    const racy = async () => {
      const ordinal = shared.next;
      await Promise.resolve();
      shared.next = ordinal + 1;
      return ordinal;
    };
    const raced = await Promise.all(Array.from({ length: 25 }, () => racy()));
    expect(new Set(raced).size).to.be.lessThan(raced.length);

    const gate = createLicensePlateGate();
    const users = ["ann", "bo"];
    const safe = await Promise.all(
      Array.from({ length: 25 }, (_, index) => gate.issue(users[index % 2]!, users)),
    );
    expect(new Set(safe.map((plate) => plate.number)).size).to.equal(safe.length);
  });

  it("allocates distinct plates for users who are entering inventory together", () => {
    const system = baseSystem({
      receivingOrders: [
        { status: "in-progress", createdBy: "Ann", receiverName: "Ann", pallets: [] },
        { status: "in-progress", createdBy: "Bo", receiverName: "Bo", pallets: [] },
      ] as unknown as InventorySystem["receivingOrders"],
    });
    expect(currentEntryUsers(system, "Ann")).to.deep.equal(["Ann", "Bo"]);
    const ann = allocateLicensePlate(system, "Ann");
    const bo = allocateLicensePlate(system, "Bo");
    expect(ann.number).to.equal("00000000");
    expect(bo.number).to.equal("99999999");
    expect(ann.code).to.equal("LP00000000");
    expect(bo.code).to.equal("LP99999999");

    const issued = [ann.number, bo.number];
    for (let count = 0; count < 10; count += 1) {
      issued.push(allocateLicensePlate(system, count % 2 === 0 ? "Ann" : "Bo").number);
    }
    expect(new Set(issued).size).to.equal(issued.length);
  });

  it("keeps the shared cursor when one division saves and another user continues", () => {
    const full = InventorySystemSchema.parse({});
    const hyperscale = scopeSystem(full, "hyperscale");
    const first = allocateLicensePlate(hyperscale, "Ann");
    mergeDivision(full, hyperscale, "hyperscale");
    const security = scopeSystem(full, "security");
    const second = allocateLicensePlate(security, "Bo");
    mergeDivision(full, security, "security");
    expect(first.number).to.equal("00000000");
    expect(second.number).to.not.equal(first.number);
    expect(full.licensePlateLedger?.nextOrdinal).to.be.greaterThan(1);
  });
});

describe("license plate queries", () => {
  it("finds one inventory line by the 8-digit number or the LP code", () => {
    const item = makeItem({
      id: ITEM_ID,
      locationId: LOCATION_ID,
      licensePlateNumber: "00000042",
      division: "hyperscale",
    });
    const other = makeItem({
      locationId: LOCATION_ID,
      sku: "CAT6-BLU-1000",
      upc: "010000000002",
      licensePlateNumber: "99999999",
      division: "hyperscale",
    });
    const system = baseSystem({ inventoryItems: [item, other] });
    const index = indexLicensePlates(system);
    expect(index.conflicts).to.deep.equal([]);
    expect(queryLicensePlate(system, "00000042")).to.deep.include({
      kind: "inventory",
      number: "00000042",
      inventoryItemId: ITEM_ID,
    });
    expect(queryLicensePlate(system, "lp00000042")?.code).to.equal("LP00000042");
    expect(lookupInventory(system, "00000042").map((row) => row.id)).to.deep.equal([ITEM_ID]);
    expect(lookupInventory(system, "LP00000042").map((row) => row.sku)).to.deep.equal([
      item.sku,
    ]);
    expect(queryLicensePlate(system, "00000007")).to.equal(null);
    expect(lookupInventory(system, "00000007")).to.deep.equal([]);
    expect(lookupInventory(system, "010000000001").map((row) => row.id)).to.deep.equal([
      ITEM_ID,
    ]);
  });

  it("resolves check-in, check-out, and hierarchy plates without mixing them", () => {
    const onHand = makeItem({
      id: ITEM_ID,
      locationId: LOCATION_ID,
      sku: "FBR-LC-12-100",
      batch: "B1",
      licensePlateNumber: "00000010",
      division: "hyperscale",
    });
    const system = baseSystem({
      inventoryItems: [onHand],
      receivingOrders: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          orderNumber: "RCV-9",
          pallets: [
            {
              cases: [
                {
                  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                  sku: "FBR-LC-12-100",
                  batch: "B1",
                  licensePlateNumber: "00000011",
                  putawayLocationId: null,
                  putawayPostedAt: null,
                },
                {
                  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  sku: "FBR-LC-12-100",
                  batch: "B1",
                  licensePlateNumber: "00000012",
                  putawayLocationId: LOCATION_ID,
                  putawayPostedAt: "2026-10-26T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ] as InventorySystem["receivingOrders"],
      shippingOrders: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          shipmentNumber: "OUT-3",
          pallets: [
            {
              cases: [
                {
                  id: "12121212-1212-4121-8121-121212121212",
                  sku: "FBR-LC-12-100",
                  batch: "B1",
                  licensePlateNumber: "00000013",
                  putawayLocationId: LOCATION_ID,
                  putawayPostedAt: null,
                },
              ],
            },
          ],
        },
      ] as InventorySystem["shippingOrders"],
    });
    const plate = addLicensePlate(system, {
      division: "hyperscale",
      locationId: LOCATION_ID,
      issuedBy: "hierarchy",
    });
    system.inventoryItems = system.inventoryItems.map((item) =>
      item.id === ITEM_ID ? { ...item, licensePlateId: plate.id } : item,
    );

    expect(queryLicensePlate(system, "00000011")).to.deep.include({
      kind: "check-in",
      orderNumber: "RCV-9",
      putawayPosted: false,
    });
    expect(lookupInventory(system, "00000011")).to.deep.equal([]);
    expect(lookupInventory(system, "00000012").map((row) => row.id)).to.deep.equal([ITEM_ID]);
    expect(queryLicensePlate(system, "LP00000013")).to.deep.include({
      kind: "check-out",
      orderNumber: "OUT-3",
    });
    expect(lookupInventory(system, "00000013").map((row) => row.id)).to.deep.equal([ITEM_ID]);
    expect(queryLicensePlate(system, plate.code)).to.deep.include({
      kind: "hierarchy",
      licensePlateId: plate.id,
    });
    expect(lookupInventory(system, plate.code).map((row) => row.id)).to.deep.equal([ITEM_ID]);
    expect(indexLicensePlates(system).conflicts).to.deep.equal([]);
  });

  it("keeps one plate on a full move and issues another when the quantity splits", () => {
    const source = makeLocation({ code: "A-01-01", division: "hyperscale" });
    const destination = makeLocation({ code: "A-01-02", division: "hyperscale" });
    const now = "2026-10-26T16:00:00.000Z";
    const whole = makeItem({
      locationId: source.id,
      quantity: 10,
      licensePlateNumber: "00000042",
      division: "hyperscale",
    });
    const moved = applyInventoryMove(
      { inventoryItems: [whole], locations: [source, destination] },
      {
        inventoryItemId: whole.id,
        destinationLocationId: destination.id,
        quantity: 10,
        confirmLargeInput: false,
      },
      now,
    );
    expect(moved.items.find((item) => item.id === whole.id)?.licensePlateNumber ?? null).to.equal(
      null,
    );
    expect(
      moved.items.find((item) => item.locationId === destination.id)?.licensePlateNumber,
    ).to.equal("00000042");

    const splitSource = makeItem({
      locationId: source.id,
      quantity: 10,
      licensePlateNumber: "00000042",
      division: "hyperscale",
    });
    const split = applyInventoryMove(
      { inventoryItems: [splitSource], locations: [source, destination] },
      {
        inventoryItemId: splitSource.id,
        destinationLocationId: destination.id,
        quantity: 4,
        confirmLargeInput: false,
      },
      now,
    );
    const system = baseSystem({
      locations: [source, destination],
      inventoryItems: split.items,
    });
    const stamped = stampInventoryLines(
      system,
      "Ann",
      split.items,
      new Set(split.changes.map((change) => change.inventoryItemId)),
    );
    expect(stamped.find((item) => item.id === splitSource.id)?.licensePlateNumber).to.equal(
      "00000042",
    );
    const arrived = stamped.find((item) => item.locationId === destination.id);
    expect(arrived?.licensePlateNumber).to.match(/^\d{8}$/);
    expect(arrived?.licensePlateNumber).to.not.equal("00000042");
    expect(indexLicensePlates({ ...system, inventoryItems: stamped }).conflicts).to.deep.equal([]);
  });
});

describe("license plate labels", () => {
  it("prints the license plate barcode with the number below it on inbound and outbound tags", () => {
    const caseItem = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      upc: "010000000001",
      sku: "FBR-LC-12-100",
      batch: "B1",
      quantityInCase: 12,
      description: "LC 12ct fiber",
      manufacturer: "Corning",
      color: "Blue",
      licensePlateNumber: "00000042",
      putawayLocationId: LOCATION_ID,
    };
    const inbound = buildInboundLabels({
      orderNumber: "RCV-1",
      poNumber: "PO-9",
      vendor: "Corning",
      pallets: [{ palletNumber: "P1", trackingNumber: "1Z", cases: [caseItem] }],
    } as ReceivingOrder);
    expect(licensePlateTag(inbound[0]!)).to.deep.equal({
      barcode: "00000042",
      number: "00000042",
    });
    expect(inbound[0]!.fields).to.deep.include({
      label: "License plate",
      value: "00000042",
    });
    expect(inbound[0]!.barcodeValue).to.equal("010000000001");
    expect(parseScanCode(inbound[0]!.qrValue).licensePlateNumber).to.equal("00000042");
    expect(parseScanCode(inbound[0]!.qrValue).sku).to.equal("FBR-LC-12-100");

    const outbound = buildOutboundLabels(
      {
        shipmentNumber: "OUT-44",
        customer: "Acme Fiber",
        carrierOutbound: "Estes",
        pallets: [{ palletNumber: "OUT-1", cases: [caseItem] }],
      } as InventorySystem["shippingOrders"][number],
      new Map([[LOCATION_ID, "A-01-01"]]),
    );
    expect(licensePlateTag(outbound[0]!)).to.deep.equal({
      barcode: "00000042",
      number: "00000042",
    });
    expect(outbound[0]!.fields).to.deep.include({
      label: "License plate",
      value: "00000042",
    });
  });

  it("puts the 8-digit barcode and the number on a hierarchy license plate tag", () => {
    const label = buildHandlingLabel({
      id: "plate-1",
      kind: "license-plate",
      code: "LP00000007",
      detail: "In a bin",
    });
    expect(label.barcodeValue).to.equal("00000007");
    expect(licensePlateTag(label)).to.deep.equal({
      barcode: "00000007",
      number: "00000007",
    });
    expect(label.fields).to.deep.include({ label: "License plate", value: "00000007" });
    expect(parseScanCode(label.qrValue).licensePlateCode).to.equal("LP00000007");
    expect(parseScanCode("00000007").licensePlateNumber).to.equal("00000007");
  });

  it("exports the on-hand license plate in the inventory spreadsheet", () => {
    const rows = lookupInventory(
      baseSystem({
        inventoryItems: [
          makeItem({
            locationId: LOCATION_ID,
            licensePlateNumber: "00000042",
            division: "hyperscale",
          }),
        ],
      }),
      "00000042",
    );
    expect(inventoryRowsToSpreadsheet(rows)).to.include("00000042");
    expect(inventoryRowsToSpreadsheet(rows)).to.include("License plate");
  });
});

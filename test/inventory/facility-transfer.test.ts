import { describe, it } from "mocha";
import { expect } from "chai";
import { createSeedSystem } from "@/backend/server/seed";
import { caseCubicInches } from "@/lib/cubing/measure";
import { buildLogbookEntries } from "@/lib/logbook/entries";
import type { InventorySystem } from "@/lib/inventory-schema";
import { parseScanCode } from "@/lib/scan-code";
import { locationSiteId } from "@/lib/sites/database";
import {
  loadFacilityTransfer,
  receiveFacilityTransfer,
} from "@/lib/transfers/facility";
import {
  buildInboundTransferLabels,
  buildOutboundTransferLabels,
} from "@/lib/transfers/labels";
import {
  netTransferMovement,
  onHandConserved,
  stockChangesBalance,
  transferUnitBalance,
} from "@/lib/transfers/math";
import { routeTransferQuantity } from "@/lib/transfers/route";
import { ValidationError } from "@/lib/validation/errors";

const NOW = "2026-10-30T15:00:00.000Z";
const LATER = "2026-10-30T16:00:00.000Z";
const DONE = "2026-10-30T17:00:00.000Z";

function onHand(system: InventorySystem, sku: string): number {
  return system.inventoryItems
    .filter((item) => item.sku === sku)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function transferTransactions(system: InventorySystem, transferId: string) {
  return system.transactions.filter((entry) => entry.referenceId === transferId);
}

function hyperscaleSite(system: InventorySystem, codename: string) {
  const site = system.sites.find(
    (entry) => entry.codename === codename && entry.division !== "security",
  );
  if (!site) throw new Error(`Missing ${codename}`);
  return site;
}

describe("transfer routing math", () => {
  it("fills slots in order and the slices add up to the receipt", () => {
    const slices = routeTransferQuantity(10, [
      { locationId: "a", locationCode: "A", openUnits: 3 },
      { locationId: "b", locationCode: "B", openUnits: 0 },
      { locationId: "c", locationCode: "C", openUnits: 4 },
      { locationId: "d", locationCode: "D", openUnits: 8 },
    ]);
    expect(slices.map((slice) => slice.quantity)).to.deep.equal([3, 4, 3]);
    expect(slices.reduce((sum, slice) => sum + slice.quantity, 0)).to.equal(10);
    for (const slice of slices) {
      const slot = [
        { id: "a", open: 3 },
        { id: "c", open: 4 },
        { id: "d", open: 8 },
      ].find((entry) => entry.id === slice.locationId);
      expect(slice.quantity).to.be.at.most(slot?.open ?? 0);
    }
  });

  it("rejects a receipt that does not fit", () => {
    expect(() =>
      routeTransferQuantity(5, [
        { locationId: "a", locationCode: "A", openUnits: 2 },
        { locationId: "b", locationCode: "B", openUnits: 2 },
      ]),
    ).to.throw(ValidationError, /remaining 1/);
  });
});

describe("facility transfer quantities", () => {
  it("keeps on-hand plus in-transit equal to the starting quantity through a partial receipt", () => {
    const system = createSeedSystem();
    const alpha = hyperscaleSite(system, "ALPHA");
    const beta = hyperscaleSite(system, "BETA");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100");
    if (!fiber) throw new Error("Missing fiber");
    const start = onHand(system, fiber.sku);
    expect(start).to.equal(24);
    expect(locationSiteId(system, system.locations.find((location) => location.id === fiber.locationId)!)).to.equal(
      alpha.id,
    );

    const loaded = loadFacilityTransfer(system, {
      actingSiteId: alpha.id,
      inventoryItemId: fiber.id,
      destinationSiteId: beta.id,
      trailerCode: "TN000142",
      quantity: 10,
      loadedBy: "Riley Associate",
      now: NOW,
    });
    const loadedBalance = transferUnitBalance(loaded);
    expect(loadedBalance).to.include({ loaded: 10, received: 0, inTransit: 10, balanced: true });
    expect(fiber.quantity).to.equal(14);
    expect(onHandConserved({ onHandAtStart: start, onHandNow: onHand(system, fiber.sku), inTransit: 10 })).to.equal(
      true,
    );

    const partial = receiveFacilityTransfer(system, {
      actingSiteId: beta.id,
      transferId: loaded.id,
      verified: true,
      lines: [{ lineId: loaded.lines[0]!.id, quantity: 4 }],
      receivedBy: "Jordan Associate",
      now: LATER,
    });
    const partialBalance = transferUnitBalance(partial);
    expect(partialBalance).to.include({ loaded: 10, received: 4, inTransit: 6, routed: 4, balanced: true });
    expect(partial.status).to.equal("partial");
    expect(
      onHandConserved({
        onHandAtStart: start,
        onHandNow: onHand(system, fiber.sku),
        inTransit: partialBalance.inTransit,
      }),
    ).to.equal(true);
    const locationCodes = new Map(system.locations.map((location) => [location.id, location.code]));
    const partialBook = buildLogbookEntries({
      receivingOrders: [],
      shippingOrders: [],
      transactions: transferTransactions(system, partial.id),
      photos: [],
      locationCodes,
      facilityTransfers: [partial],
    });
    expect(partialBook.find((entry) => entry.kind === "transfer-outbound")?.totals.units).to.equal(10);
    expect(partialBook.find((entry) => entry.kind === "transfer-inbound")?.totals.units).to.equal(4);
    expect(
      partialBook
        .find((entry) => entry.kind === "transfer-inbound")
        ?.lines.reduce((sum, line) => sum + line.quantity, 0),
    ).to.equal(4);
    expect(
      netTransferMovement({
        outboundDeltas: transferTransactions(system, partial.id)
          .filter((entry) => entry.type === "transfer-outbound")
          .map((entry) => entry.quantityDelta),
        inboundDeltas: transferTransactions(system, partial.id)
          .filter((entry) => entry.type === "transfer-inbound")
          .map((entry) => entry.quantityDelta),
        inTransit: partialBalance.inTransit,
      }).closed,
    ).to.equal(true);

    const openBefore = partialBalance.inTransit;
    expect(() =>
      receiveFacilityTransfer(system, {
        actingSiteId: beta.id,
        transferId: partial.id,
        verified: true,
        lines: [{ lineId: partial.lines[0]!.id, quantity: openBefore + 1 }],
        receivedBy: "Jordan Associate",
        now: DONE,
      }),
    ).to.throw(ValidationError, /still on the trailer/);
    expect(transferUnitBalance(partial).received).to.equal(4);
    expect(onHand(system, fiber.sku)).to.equal(start - openBefore);

    const finished = receiveFacilityTransfer(system, {
      actingSiteId: beta.id,
      transferId: partial.id,
      verified: true,
      lines: [{ lineId: partial.lines[0]!.id, quantity: openBefore }],
      receivedBy: "Jordan Associate",
      now: DONE,
    });
    const finishedBalance = transferUnitBalance(finished);
    expect(finishedBalance).to.include({
      loaded: 10,
      received: 10,
      inTransit: 0,
      routed: 10,
      balanced: true,
    });
    expect(finished.status).to.equal("received");
    expect(onHand(system, fiber.sku)).to.equal(start);
    expect(fiber.quantity).to.equal(14);
    const destinationUnits = system.inventoryItems
      .filter((item) => item.sku === fiber.sku && item.locationId !== fiber.locationId)
      .reduce((sum, item) => sum + item.quantity, 0);
    expect(destinationUnits).to.equal(10);
    expect(fiber.quantity + destinationUnits).to.equal(start);

    const transactions = transferTransactions(system, finished.id);
    expect(stockChangesBalance(transactions.map((entry) => ({
      quantityBefore: entry.quantityBefore ?? -1,
      quantityAfter: entry.quantityAfter ?? -1,
      quantityDelta: entry.quantityDelta,
    })))).to.equal(true);
    const outbound = transactions.filter((entry) => entry.type === "transfer-outbound");
    const inbound = transactions.filter((entry) => entry.type === "transfer-inbound");
    expect(outbound.map((entry) => entry.quantityDelta)).to.deep.equal([-10]);
    expect(outbound[0]).to.include({ quantityBefore: 24, quantityAfter: 14 });
    expect(inbound.reduce((sum, entry) => sum + entry.quantityDelta, 0)).to.equal(10);
    expect(
      netTransferMovement({
        outboundDeltas: outbound.map((entry) => entry.quantityDelta),
        inboundDeltas: inbound.map((entry) => entry.quantityDelta),
        inTransit: 0,
      }).closed,
    ).to.equal(true);

    const outboundLabels = buildOutboundTransferLabels(finished);
    expect(outboundLabels).to.have.length(1);
    expect(outboundLabels[0]?.barcodeValue).to.equal(fiber.upc);
    expect(outboundLabels[0]?.fields.find((field) => field.label === "Nomenclature")?.value).to.equal(
      "BETA",
    );
    expect(outboundLabels[0]?.fields.find((field) => field.label === "Qty")?.value).to.equal("10");
    const outboundScan = parseScanCode(outboundLabels[0]!.qrValue);
    expect(outboundScan.sku).to.equal(fiber.sku);
    expect(outboundScan.upc).to.equal(fiber.upc);
    expect(outboundScan.licensePlateNumber).to.equal(finished.lines[0]?.outboundLicensePlateNumber);

    const inboundLabels = buildInboundTransferLabels(finished);
    const inboundUnits = inboundLabels.reduce(
      (sum, label) => sum + Number(label.fields.find((field) => field.label === "Qty")?.value ?? 0),
      0,
    );
    expect(inboundUnits).to.equal(10);
    const inboundPlates = finished.lines[0]!.routes.map((route) => route.licensePlateNumber);
    expect(new Set([finished.lines[0]!.outboundLicensePlateNumber, ...inboundPlates]).size).to.equal(
      1 + inboundPlates.length,
    );
    expect(inboundLabels.map((label) => parseScanCode(label.qrValue).licensePlateNumber)).to.deep.equal(
      inboundPlates,
    );
    for (const label of inboundLabels) {
      expect(label.fields.some((field) => field.label === "Route" && field.value.length > 0)).to.equal(
        true,
      );
    }

    const atSource = buildLogbookEntries({
      receivingOrders: [],
      shippingOrders: [],
      transactions,
      photos: [],
      locationCodes,
      facilityTransfers: [finished],
      siteId: alpha.id,
    });
    expect(atSource.map((entry) => entry.kind)).to.deep.equal(["transfer-outbound"]);
    expect(atSource[0]?.totals.units).to.equal(10);

    const atDestination = buildLogbookEntries({
      receivingOrders: [],
      shippingOrders: [],
      transactions,
      photos: [],
      locationCodes,
      facilityTransfers: [finished],
      siteId: beta.id,
    });
    expect(atDestination.map((entry) => entry.kind)).to.deep.equal(["transfer-inbound"]);
    expect(atDestination[0]?.totals.units).to.equal(10);
    expect(atDestination[0]?.lines.reduce((sum, line) => sum + line.quantity, 0)).to.equal(10);
  });

  it("routes a verified receipt across locations and the slices match the inventory increase", () => {
    const system = createSeedSystem();
    const alpha = hyperscaleSite(system, "ALPHA");
    const beta = hyperscaleSite(system, "BETA");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100");
    const cube = system.itemCubes.find((entry) => entry.sku === "FBR-LC-12-100");
    if (!fiber || !cube) throw new Error("Missing fiber cube");
    const perUnit = caseCubicInches(1, cube);
    const slots = system.locations
      .filter((location) => location.siteId === beta.id && location.isActive)
      .sort((left, right) => left.code.localeCompare(right.code));
    expect(slots.length).to.be.at.least(2);
    for (const item of system.inventoryItems) {
      if (slots.some((location) => location.id === item.locationId)) item.quantity = 0;
    }
    slots[0]!.cubeCapacityCubicInches = perUnit * 4;
    slots[1]!.cubeCapacityCubicInches = perUnit * 6;
    for (const extra of slots.slice(2)) extra.isActive = false;
    const start = onHand(system, fiber.sku);

    const loaded = loadFacilityTransfer(system, {
      actingSiteId: alpha.id,
      inventoryItemId: fiber.id,
      destinationSiteId: beta.id,
      trailerCode: "TN000143",
      quantity: 10,
      loadedBy: "Riley Associate",
      now: NOW,
    });
    const received = receiveFacilityTransfer(system, {
      actingSiteId: beta.id,
      transferId: loaded.id,
      verified: true,
      lines: [{ lineId: loaded.lines[0]!.id, quantity: 10 }],
      receivedBy: "Jordan Associate",
      now: LATER,
    });
    const quantities = received.lines[0]!.routes.map((route) => route.quantity);
    expect(quantities).to.deep.equal([4, 6]);
    expect(quantities.reduce((sum, quantity) => sum + quantity, 0)).to.equal(10);
    expect(
      system.inventoryItems.find(
        (item) => item.sku === fiber.sku && item.locationId === slots[0]!.id,
      )?.quantity,
    ).to.equal(4);
    expect(
      system.inventoryItems.find(
        (item) => item.sku === fiber.sku && item.locationId === slots[1]!.id,
      )?.quantity,
    ).to.equal(6);
    expect(onHand(system, fiber.sku)).to.equal(start);
    expect(transferUnitBalance(received).balanced).to.equal(true);
    const labels = buildInboundTransferLabels(received);
    expect(labels.map((label) => label.fields.find((field) => field.label === "Route")?.value)).to.deep.equal([
      slots[0]!.code,
      slots[1]!.code,
    ]);
    expect(labels.map((label) => Number(label.fields.find((field) => field.label === "Qty")?.value))).to.deep.equal([
      4, 6,
    ]);
  });

  it("adds a second line onto the same trailer and the totals stay additive", () => {
    const system = createSeedSystem();
    const alpha = hyperscaleSite(system, "ALPHA");
    const beta = hyperscaleSite(system, "BETA");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100" && item.quantity === 24);
    const cat6 = system.inventoryItems.find(
      (item) => item.sku === "CAT6-BLU-1000" && item.locationId !== undefined && item.quantity === 48,
    );
    if (!fiber || !cat6) throw new Error("Missing stock");
    const fiberStart = onHand(system, fiber.sku);
    const cat6Start = onHand(system, cat6.sku);

    const first = loadFacilityTransfer(system, {
      actingSiteId: alpha.id,
      inventoryItemId: fiber.id,
      destinationSiteId: beta.id,
      trailerCode: "TN000144",
      quantity: 10,
      loadedBy: "Riley Associate",
      now: NOW,
    });
    const second = loadFacilityTransfer(system, {
      actingSiteId: alpha.id,
      inventoryItemId: cat6.id,
      destinationSiteId: beta.id,
      trailerCode: "TN000144",
      quantity: 5,
      loadedBy: "Riley Associate",
      now: LATER,
    });
    expect(second.id).to.equal(first.id);
    expect(transferUnitBalance(second)).to.include({ loaded: 15, received: 0, inTransit: 15, lineCount: 2, balanced: true });
    expect(onHand(system, fiber.sku)).to.equal(fiberStart - 10);
    expect(onHand(system, cat6.sku)).to.equal(cat6Start - 5);

    const received = receiveFacilityTransfer(system, {
      actingSiteId: beta.id,
      transferId: second.id,
      verified: true,
      lines: second.lines.map((line) => ({ lineId: line.id, quantity: line.quantityLoaded })),
      receivedBy: "Jordan Associate",
      now: DONE,
    });
    const balance = transferUnitBalance(received);
    expect(balance).to.include({ loaded: 15, received: 15, inTransit: 0, routed: 15, balanced: true });
    expect(onHand(system, fiber.sku)).to.equal(fiberStart);
    expect(onHand(system, cat6.sku)).to.equal(cat6Start);
    const deltas = transferTransactions(system, received.id).map((entry) => entry.quantityDelta);
    expect(deltas.reduce((sum, delta) => sum + delta, 0)).to.equal(0);
    expect(stockChangesBalance(transferTransactions(system, received.id).map((entry) => ({
      quantityBefore: entry.quantityBefore ?? -1,
      quantityAfter: entry.quantityAfter ?? -1,
      quantityDelta: entry.quantityDelta,
    })))).to.equal(true);
  });

  it("rejects loads and receipts that would break the quantity", () => {
    const system = createSeedSystem();
    const alpha = hyperscaleSite(system, "ALPHA");
    const beta = hyperscaleSite(system, "BETA");
    const fiber = system.inventoryItems.find((item) => item.sku === "FBR-LC-12-100");
    if (!fiber) throw new Error("Missing fiber");
    const before = fiber.quantity;

    expect(() =>
      loadFacilityTransfer(system, {
        actingSiteId: alpha.id,
        inventoryItemId: fiber.id,
        destinationSiteId: beta.id,
        trailerCode: "TN000145",
        quantity: before + 1,
        loadedBy: "Riley Associate",
        now: NOW,
      }),
    ).to.throw(ValidationError, /Not enough on-hand/);
    expect(fiber.quantity).to.equal(before);
    expect(system.facilityTransfers ?? []).to.have.length(0);

    expect(() =>
      loadFacilityTransfer(system, {
        actingSiteId: alpha.id,
        inventoryItemId: fiber.id,
        destinationSiteId: alpha.id,
        trailerCode: "TN000145",
        quantity: 1,
        loadedBy: "Riley Associate",
        now: NOW,
      }),
    ).to.throw(ValidationError, /different destination/);
    expect(fiber.quantity).to.equal(before);

    const loaded = loadFacilityTransfer(system, {
      actingSiteId: alpha.id,
      inventoryItemId: fiber.id,
      destinationSiteId: beta.id,
      trailerCode: "TN000145",
      quantity: 2,
      loadedBy: "Riley Associate",
      now: NOW,
    });
    expect(() =>
      receiveFacilityTransfer(system, {
        actingSiteId: beta.id,
        transferId: loaded.id,
        verified: false,
        lines: [{ lineId: loaded.lines[0]!.id, quantity: 2 }],
        receivedBy: "Jordan Associate",
        now: LATER,
      }),
    ).to.throw(ValidationError, /Verify the receipt/);
    expect(transferUnitBalance(loaded).received).to.equal(0);
    expect(onHand(system, fiber.sku)).to.equal(before - 2);
  });
});

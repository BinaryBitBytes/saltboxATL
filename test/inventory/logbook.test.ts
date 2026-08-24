import { describe, it } from "mocha";
import { expect } from "chai";
import {
  buildLoadManifest,
  buildPackSlip,
} from "@/lib/shipping/documents";
import { buildLogbookEntries } from "@/lib/logbook/entries";
import type {
  InventoryTransaction,
  PhotoAttachment,
  ReceivingOrder,
  ShippingOrder,
} from "@/lib/inventory-schema";
import { createId } from "@/backend/server/helperUtils";

const locationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const caseA = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  upc: "010000000001",
  sku: "FBR-LC-12-100",
  batch: "B1",
  quantityInCase: 12,
  description: "LC 12ct fiber",
  fiber: null,
  putawayRoomId: null,
  putawayLocationId: locationId,
  putawayPostedAt: null,
};
const caseB = {
  ...caseA,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  sku: "CAT6-BLU-1000",
  upc: "010000000002",
  quantityInCase: 4,
  description: "Cat6 box",
  batch: null,
};

const shipment = {
  id: "11111111-1111-4111-8111-111111111111",
  shipmentNumber: "OUT-44",
  customer: "Acme Fiber",
  carrierOutbound: "Estes",
  shipperName: "Jordan Associate",
  shippedAt: "2026-08-21T12:00:00.000Z",
  notes: "Dock 2",
  pallets: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      palletNumber: "OUT-1",
      cases: [caseA],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      palletNumber: "OUT-2",
      cases: [caseB],
    },
  ],
} as ShippingOrder;

const locations = new Map([[locationId, "A-01-01"]]);

describe("outbound packing documents", () => {
  it("builds a packing slip with every picked line and unit totals", () => {
    const slip = buildPackSlip(shipment, locations);
    expect(slip.kind).to.equal("pack-slip");
    expect(slip.lines).to.have.length(2);
    expect(slip.totalUnits).to.equal(16);
    expect(slip.skuCount).to.equal(2);
    expect(slip.palletCount).to.equal(2);
    expect(slip.lines[0].fromLocation).to.equal("A-01-01");
    expect(slip.customer).to.equal("Acme Fiber");
  });

  it("builds a load manifest grouped by pallet", () => {
    const manifest = buildLoadManifest(shipment, locations);
    expect(manifest.kind).to.equal("load-manifest");
    expect(manifest.pallets).to.have.length(2);
    expect(manifest.pallets[1].palletNumber).to.equal("OUT-2");
    expect(manifest.pallets[1].unitCount).to.equal(4);
    expect(manifest.totals).to.deep.equal({
      pallets: 2,
      cases: 2,
      skus: 2,
      units: 16,
    });
  });
});

describe("operations logbook", () => {
  it("reviews shipments, inbound deliveries, and grouped damage write-offs", () => {
    const receivingId = createId();
    const adjustmentId = createId();
    const receiving = {
      id: receivingId,
      orderNumber: "RCV-9",
      poNumber: "PO-88",
      vendor: "Corning",
      receivedAt: "2026-08-20T15:00:00.000Z",
      carrierInbound: "XPO",
      receiverName: "Riley User",
      status: "received",
      pallets: [
        {
          id: createId(),
          palletNumber: "P1",
          cases: [caseA],
        },
      ],
    } as ReceivingOrder;

    const photo: PhotoAttachment = {
      id: createId(),
      ownerType: "shipping-order",
      ownerId: shipment.id,
      documentKind: "freight-proof",
      originalName: "bol.jpg",
      mimeType: "image/jpeg",
      size: 1200,
      createdAt: "2026-08-21T12:05:00.000Z",
    };

    const damageOut: InventoryTransaction = {
      id: createId(),
      type: "damage",
      occurredAt: "2026-08-21T18:00:00.000Z",
      sku: "FBR-LC-12-100",
      batch: null,
      inventoryItemId: null,
      locationId,
      destinationLocationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      quantityDelta: -3,
      reason: "Crushed carton",
      referenceType: "adjustment",
      referenceId: adjustmentId,
    };
    const damageIn: InventoryTransaction = {
      ...damageOut,
      id: createId(),
      quantityDelta: 3,
      locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    const entries = buildLogbookEntries({
      receivingOrders: [receiving],
      shippingOrders: [shipment],
      transactions: [damageOut, damageIn],
      photos: [photo],
      locationCodes: new Map([
        [locationId, "A-01-01"],
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "DMG-01"],
      ]),
    });

    expect(entries.map((entry) => entry.kind)).to.deep.equal([
      "damage",
      "shipment",
      "delivery",
    ]);

    const outbound = entries.find((entry) => entry.kind === "shipment");
    expect(outbound?.photos).to.have.length(1);
    expect(outbound?.packSlip?.totalUnits).to.equal(16);
    expect(outbound?.manifest?.totals.pallets).to.equal(2);

    const delivery = entries.find((entry) => entry.kind === "delivery");
    expect(delivery?.title).to.include("RCV-9");
    expect(delivery?.subtitle).to.include("PO-88");
    expect(delivery?.totals.units).to.equal(12);

    const damage = entries.find((entry) => entry.kind === "damage");
    expect(damage?.totals.units).to.equal(3);
    expect(damage?.lines).to.have.length(1);
    expect(damage?.reason).to.equal("Crushed carton");
    expect(damage?.lines[0].location).to.equal("DMG-01");
  });
});

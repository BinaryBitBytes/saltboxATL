import { describe, it } from "mocha";
import { expect } from "chai";
import {
  buildItemCatalog,
  hasReportFilters,
  itemReportToCsv,
  queryItemReport,
} from "@/lib/reports/item-report";
import type {
  InventoryItem,
  Location,
  ReceivingOrder,
  Room,
  ShippingOrder,
} from "@/lib/inventory-schema";
import { createId } from "@/backend/server/helperUtils";

const room: Room = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Fiber Room",
};
const bin: Location = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "FIBER-A1",
  roomId: room.id,
  isActive: true,
};
const onHand: InventoryItem = {
  id: createId(),
  sku: "FBR-LC-12-100",
  upc: "010000000001",
  batch: "B1",
  locationId: bin.id,
  quantity: 24,
  description: "12-strand LC fiber, 100m",
};
const receiving = {
  id: createId(),
  poNumber: "PO-88",
  orderNumber: "RCV-9",
  status: "received",
  pallets: [
    {
      id: createId(),
      palletNumber: "P1",
      cases: [
        {
          id: createId(),
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          batch: "B1",
          quantityInCase: 12,
          description: "12-strand LC fiber, 100m",
          fiber: null,
          putawayRoomId: room.id,
          putawayLocationId: bin.id,
        },
        {
          id: createId(),
          sku: "CAT6-BLU-1000",
          upc: "010000000002",
          batch: null,
          quantityInCase: 8,
          description: "Cat6 blue 1000ft box",
          fiber: null,
          putawayRoomId: null,
          putawayLocationId: null,
        },
      ],
    },
  ],
} as ReceivingOrder;

const shipment = {
  id: createId(),
  shipmentNumber: "OUT-44",
  pallets: [
    {
      id: createId(),
      palletNumber: "OUT-1",
      cases: [
        {
          id: createId(),
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          batch: "B1",
          quantityInCase: 4,
          description: "12-strand LC fiber, 100m",
          fiber: null,
          putawayRoomId: null,
          putawayLocationId: bin.id,
        },
      ],
    },
  ],
} as ShippingOrder;

const catalog = buildItemCatalog({
  inventoryItems: [onHand],
  locations: [bin],
  rooms: [room],
  receivingOrders: [receiving],
  shippingOrders: [shipment],
});

describe("item report queries", () => {
  it("requires at least one filter before generating rows", () => {
    expect(hasReportFilters({})).to.equal(false);
    expect(queryItemReport(catalog, {}).rows).to.have.length(0);
  });

  it("finds items by SKU, UPC, description, and location", () => {
    const bySku = queryItemReport(catalog, { sku: "FBR-LC" });
    expect(bySku.rows.some((row) => row.source === "on-hand")).to.equal(true);
    expect(bySku.rows.some((row) => row.source === "inbound")).to.equal(true);
    expect(bySku.rows.some((row) => row.source === "outbound")).to.equal(true);
    expect(bySku.totals.skus).to.equal(1);

    const byUpc = queryItemReport(catalog, { upc: "010000000002" });
    expect(byUpc.rows).to.have.length(1);
    expect(byUpc.rows[0].sku).to.equal("CAT6-BLU-1000");

    const byDescription = queryItemReport(catalog, { description: "cat6" });
    expect(byDescription.rows[0].description).to.match(/Cat6/i);

    const byLocation = queryItemReport(catalog, { location: "fiber" });
    expect(byLocation.rows.every((row) => row.roomName === "Fiber Room" || row.locationCode === "FIBER-A1")).to.equal(
      true,
    );
    expect(byLocation.rows.some((row) => row.source === "on-hand")).to.equal(true);
  });

  it("finds PO lines and related on-hand items for that purchase order", () => {
    const report = queryItemReport(catalog, { poNumber: "PO-88" });
    expect(report.rows.some((row) => row.source === "inbound" && row.sku === "CAT6-BLU-1000")).to.equal(
      true,
    );
    expect(report.rows.some((row) => row.source === "on-hand" && row.sku === "FBR-LC-12-100")).to.equal(
      true,
    );
    expect(report.rows.some((row) => row.sourceLabel.includes("PO-88"))).to.equal(
      true,
    );
  });

  it("combines filters with AND and exports CSV", () => {
    const report = queryItemReport(catalog, {
      sku: "FBR",
      location: "FIBER-A1",
    });
    expect(report.rows.every((row) => row.sku.includes("FBR"))).to.equal(true);
    expect(report.rows.every((row) => row.locationCode === "FIBER-A1")).to.equal(
      true,
    );
    const csv = itemReportToCsv(report);
    expect(csv).to.match(/^SKU,UPC,Description/);
    expect(csv).to.include("FBR-LC-12-100");
    expect(csv).to.include("On hand");
  });
});

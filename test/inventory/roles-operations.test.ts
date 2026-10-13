import { describe, it } from "mocha";
import { expect } from "chai";
import {
  SaveBuyerPurchaseOrderInputSchema,
  type PurchaseOrder,
  type ShippingOrder,
} from "@/lib/inventory-schema";
import { buildInboundForecast } from "@/lib/inbound/forecast";
import {
  applyDeliveryNotes,
  applyDeliveryScan,
  DeliveryCheckInError,
  deliveryProgress,
} from "@/lib/delivery/check-in";
import {
  assignPurchaseOrderJobId,
  saveBuyerPurchaseOrder,
  upsertPurchaseOrder,
} from "@/lib/purchase-orders";
import { encodeScanPayload } from "@/lib/scan-code";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PALLET_ID = "22222222-2222-4222-8222-222222222222";
const CASE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const CASE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const SCAN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = "2026-10-13T15:00:00.000Z";

function buyerInput(overrides?: Partial<Parameters<typeof saveBuyerPurchaseOrder>[1]>) {
  return {
    id: PO_ID,
    purchaseOrderNumber: "PO-100",
    generatedAt: NOW,
    projectId: "PRJ-9",
    vendor: "Corning",
    carrier: "Estes",
    expectedArrivalAt: "2026-10-20T12:00:00.000Z",
    buyerName: "Morgan Coordinator",
    notes: "Two pallets of LC jumpers",
    expectationStatus: "expected" as const,
    expectedPalletCount: 2,
    lines: [
      {
        id: LINE_ID,
        sku: "FBR-LC-12-100",
        upc: "010000000001",
        description: "LC 12ct fiber",
        quantity: 12,
      },
    ],
    uploadedBy: "Morgan Coordinator",
    ...overrides,
  };
}

function load(): ShippingOrder {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    shippedAt: NOW,
    customer: "Site A",
    shipmentNumber: "OUT-44",
    carrierOutbound: "Estes",
    shipperName: "Jordan Associate",
    loadPalletCount: 1,
    waitingOnItems: false,
    itemsInJeopardy: [],
    status: "shipped",
    pallets: [
      {
        id: PALLET_ID,
        palletNumber: "PLT-9",
        trackingNumber: "1Z999",
        isPartial: false,
        partialedBy: null,
        expectedSkuCount: 2,
        actualSkuCount: 2,
        expectedCaseCount: 2,
        actualCaseCount: 2,
        cubeRoute: null,
        cases: [
          {
            id: CASE_A,
            upc: "010000000001",
            sku: "FBR-LC-12-100",
            batch: null,
            quantityInCase: 4,
            description: "LC jumper",
            manufacturer: "",
            color: null,
            fiber: null,
            putawayRoomId: null,
            putawayLocationId: null,
            putawayPostedAt: null,
          },
          {
            id: CASE_B,
            upc: "010000000002",
            sku: "FBR-SC-6-50",
            batch: null,
            quantityInCase: 2,
            description: "SC jumper",
            manufacturer: "",
            color: null,
            fiber: null,
            putawayRoomId: null,
            putawayLocationId: null,
            putawayPostedAt: null,
          },
        ],
      },
    ],
  } as ShippingOrder;
}

describe("buyer purchase orders and delivery check-in", () => {
  it("keeps the project manager job ID when a coordinator updates the buyer PO", () => {
    const orders: PurchaseOrder[] = [];
    saveBuyerPurchaseOrder(orders, buyerInput());
    assignPurchaseOrderJobId(orders, "PO-100", "JOB-42");
    saveBuyerPurchaseOrder(orders, buyerInput({ vendor: "CommScope", carrier: "XPO" }));
    expect(orders).to.have.length(1);
    expect(orders[0].jobIdNumber).to.equal("JOB-42");
    expect(orders[0].vendor).to.equal("CommScope");
    expect(orders[0].carrier).to.equal("XPO");
    expect(orders[0].source).to.equal("coordinator");
    expect(orders[0].lines?.[0].sku).to.equal("FBR-LC-12-100");
  });

  it("does not clear buyer details when receiving creates the same PO", () => {
    const orders: PurchaseOrder[] = [];
    saveBuyerPurchaseOrder(orders, buyerInput());
    assignPurchaseOrderJobId(orders, "PO-100", "JOB-42");
    upsertPurchaseOrder(orders, {
      id: "99999999-9999-4999-8999-999999999999",
      purchaseOrderNumber: "PO-100",
      generatedAt: NOW,
      jobIdNumber: null,
    });
    expect(orders[0].vendor).to.equal("Corning");
    expect(orders[0].lines).to.have.length(1);
    expect(orders[0].jobIdNumber).to.equal("JOB-42");
    expect(orders[0].source).to.equal("coordinator");
  });

  it("refuses a job ID when no purchase order exists yet", () => {
    expect(assignPurchaseOrderJobId([], "PO-MISSING", "JOB-1")).to.equal(null);
  });

  it("forecasts upcoming freight by carrier and vendor", () => {
    const orders: PurchaseOrder[] = [];
    saveBuyerPurchaseOrder(orders, buyerInput());
    saveBuyerPurchaseOrder(
      orders,
      buyerInput({
        id: "22222222-2222-4222-8222-222222222223",
        purchaseOrderNumber: "PO-200",
        carrier: "Estes",
        vendor: "Leviton",
        lines: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccc09",
            sku: "FBR-SC-6-50",
            upc: "",
            description: "SC jumper",
            quantity: 8,
          },
        ],
      }),
    );
    const forecast = buildInboundForecast(orders, [
      {
        id: "33333333-3333-4333-8333-333333333333",
        poNumber: "PO-100",
        status: "received",
        pallets: [
          {
            cases: [{ sku: "FBR-LC-12-100", quantityInCase: 12 }],
          },
        ],
      } as never,
    ]);
    const received = forecast.rows.find((row) => row.purchaseOrderNumber === "PO-100");
    expect(received?.derivedStatus).to.equal("received");
    expect(received?.lines[0].receivedQuantity).to.equal(12);
    expect(forecast.upcomingCount).to.equal(1);
    expect(forecast.upcomingUnits).to.equal(8);
    expect(forecast.byCarrier[0]).to.deep.include({ carrier: "Estes", units: 8 });
    expect(forecast.awaitingJobId).to.equal(1);
  });

  it("rejects buyer PO lines that do not say what should arrive", () => {
    const parsed = SaveBuyerPurchaseOrderInputSchema.safeParse({
      purchaseOrderNumber: "PO-1",
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
      lines: [{ sku: "", description: "", quantity: 1 }],
    });
    expect(parsed.success).to.equal(false);
  });

  it("checks in a pallet or each case and stamps location with the server time", () => {
    const order = load();
    order.delivery = applyDeliveryNotes(order, "Dock 4, call on arrival", NOW, "Devon Driver");
    const caseScan = applyDeliveryScan(order, {
      id: SCAN_ID,
      code: encodeScanPayload({ sku: "FBR-LC-12-100", upc: "010000000001" }),
      scannedAt: "2026-10-13T18:04:00.000Z",
      scannedBy: "Devon Driver",
      latitude: 33.749,
      longitude: -84.388,
      accuracyMeters: 12,
    });
    order.delivery = caseScan;
    expect(caseScan.scans[0].match).to.equal("case");
    expect(caseScan.scans[0].latitude).to.equal(33.749);
    expect(caseScan.scans[0].scannedAt).to.equal("2026-10-13T18:04:00.000Z");
    expect(caseScan.notes).to.equal("Dock 4, call on arrival");
    expect(deliveryProgress(order).status).to.equal("partial");

    expect(() =>
      applyDeliveryScan(order, {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
        code: "010000000001",
        scannedAt: NOW,
      }),
    ).to.throw(DeliveryCheckInError, /already checked in/i);

    order.delivery = applyDeliveryScan(order, {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
      code: "PLT-9",
      scannedAt: "2026-10-13T18:10:00.000Z",
      scannedBy: "Devon Driver",
    });
    expect(deliveryProgress(order).status).to.equal("delivered");
    expect(order.delivery.deliveredAt).to.equal("2026-10-13T18:10:00.000Z");
    expect(order.delivery.scans[1].latitude).to.equal(null);
    expect(deliveryProgress(order).pallets[0].cases.every((item) => item.delivered)).to.equal(
      true,
    );

    const other = load();
    expect(() =>
      applyDeliveryScan(other, {
        id: SCAN_ID,
        code: "NOT-ON-LOAD",
        scannedAt: NOW,
      }),
    ).to.throw(DeliveryCheckInError, /not on this load/i);
  });
});

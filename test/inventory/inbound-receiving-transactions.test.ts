import { describe, it } from "mocha";
import { expect } from "chai";
import {
  INBOUND_CANCEL_CONFIRMATION,
  INBOUND_CANCEL_REQUIRES_BUTTON,
  InventorySystemSchema,
  PurchaseDocumentSchema,
  type InventorySystem,
  type PurchaseOrder,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { buildExpectedInboundLoad } from "@/lib/documents/inbound-load";
import { applyRecognizedPurchase } from "@/lib/documents/apply";
import { refreshExpectedLoad, updateInboundEntry } from "@/lib/inbound/entry";
import { saveBuyerPurchaseOrder, upsertPurchaseOrder } from "@/lib/purchase-orders";
import { mapReceivingOrder } from "@/backend/server/pg-mapper";
import {
  ASSOCIATES_CANNOT_CANCEL,
  BACKORDER_CONFIRM,
  MANAGERS_OR_COORDINATORS_CANCEL,
  PALLET_ALREADY_PARTIAL,
  PALLET_NOT_OPENED,
  PALLET_NOT_SHORT,
  PARTIAL_NAME,
  PO_ALREADY_CANCELLED,
  PO_HAS_ON_HAND,
  PO_NOT_IN_RECEIVING,
  RECEIVE_ONE_CASE,
  RECEIVE_ONE_MORE,
  TYPE_CANCEL_PHRASE,
  applyPartialInboundPallet,
  backorderLinesForShipment,
  cancelEnteredInboundPurchaseOrder,
  finishReceivingShipment,
  inboundCancelApplies,
} from "@/lib/inbound/receiving-transactions";

const NOW = "2026-10-21T15:00:00.000Z";
const PO_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "33333333-3333-4333-8333-333333333333";
const LINE_TWO = "33333333-3333-4333-8333-333333333334";
const DOC_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "12121212-1212-4212-8212-121212121213";
const LOAD_ID = "66666666-6666-4666-8666-666666666666";
const PALLET_ID = "77777777-7777-4777-8777-777777777777";
const PALLET_TWO = "77777777-7777-4777-8777-777777777778";
const CASE_ID = "88888888-8888-4888-8888-888888888888";
const CASE_TWO = "88888888-8888-4888-8888-888888888889";
const LOC_ID = "99999999-9999-4999-8999-999999999982";

function nextIdFactory() {
  let value = 1;
  return () => {
    const id = `99999999-9999-4999-8999-${String(value).padStart(12, "0")}`;
    value += 1;
    return id;
  };
}

function system(partial: {
  purchaseOrders?: PurchaseOrder[];
  receivingOrders?: ReceivingOrder[];
  purchaseDocuments?: InventorySystem["purchaseDocuments"];
  inventoryItems?: InventorySystem["inventoryItems"];
  transactions?: InventorySystem["transactions"];
}): InventorySystem {
  return InventorySystemSchema.parse(partial);
}

function buyer(quantity = 4): PurchaseOrder {
  const orders: PurchaseOrder[] = [];
  saveBuyerPurchaseOrder(orders, {
    id: PO_ID,
    purchaseOrderNumber: "PO-100",
    generatedAt: NOW,
    projectId: "PRJ-9",
    jobIdNumber: "JOB-42",
    vendor: "Corning",
    carrier: "Estes",
    expectedArrivalAt: NOW,
    buyerName: "Morgan Coordinator",
    notes: "Dock 4",
    expectationStatus: "expected",
    expectedPalletCount: 1,
    lines: [
      {
        id: LINE_ID,
        sku: "FBR-LC-12-100",
        upc: "010000000001",
        description: "LC jumper",
        quantity,
      },
      {
        id: LINE_TWO,
        sku: "FBR-SC-6-50",
        upc: "010000000002",
        description: "SC jumper",
        quantity: 2,
      },
    ],
    uploadedBy: "Morgan Coordinator",
  });
  const order = orders[0];
  if (!order) throw new Error("buyer PO missing");
  return order;
}

function document() {
  return PurchaseDocumentSchema.parse({
    id: DOC_ID,
    purchaseOrderNumber: "PO-100",
    kind: "purchase-order",
    originalName: "po.pdf",
    mimeType: "application/pdf",
    size: 1200,
    pricesRedacted: true,
    recognitionSource: "embedded-text",
    recognitionNote: "Read from text embedded in the PDF.",
    lines: [
      {
        sku: "FBR-LC-12-100",
        upc: "010000000001",
        description: "LC jumper",
        quantity: 4,
        unitPrice: null,
        extendedPrice: null,
      },
    ],
    createdAt: NOW,
  });
}

function startedLoad(): ReceivingOrder {
  const load = buildExpectedInboundLoad({
    id: LOAD_ID,
    palletId: PALLET_ID,
    caseIds: [CASE_ID, CASE_TWO],
    now: NOW,
    purchaseOrderNumber: "PO-100",
    vendor: "Corning",
    carrier: "Estes",
    palletCount: 1,
    receiverName: "Jordan Associate",
    lines: [
      {
        sku: "FBR-LC-12-100",
        upc: "010000000001",
        description: "LC jumper",
        quantity: 4,
      },
      {
        sku: "FBR-SC-6-50",
        upc: "010000000002",
        description: "SC jumper",
        quantity: 2,
      },
    ],
    existingOrderNumbers: [],
  });
  load.status = "in-progress";
  return load;
}

function cancelOptions(
  overrides: Partial<Parameters<typeof cancelEnteredInboundPurchaseOrder>[2]> = {},
) {
  return {
    actorRole: "manager",
    actorId: ACTOR_ID,
    confirmText: INBOUND_CANCEL_CONFIRMATION,
    now: NOW,
    nextId: nextIdFactory(),
    ...overrides,
  };
}

describe("inbound receiving cancel, partial pallet, and backorder", () => {
  it("uses the exact confirmation phrase CancelRightMeow", () => {
    expect(INBOUND_CANCEL_CONFIRMATION).to.equal("CancelRightMeow");
  });

  it("does not treat an unchecked expected draft as a shipment that has entered receiving", () => {
    const draft = startedLoad();
    draft.status = "draft";
    const purchaseOrder = buyer();
    expect(inboundCancelApplies(draft, purchaseOrder, [draft])).to.equal(false);
    const walkUp = startedLoad();
    walkUp.intake = undefined;
    const orders: PurchaseOrder[] = [];
    upsertPurchaseOrder(orders, {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      generatedAt: NOW,
    });
    expect(inboundCancelApplies(walkUp, orders[0] ?? null, [walkUp])).to.equal(false);
    expect(inboundCancelApplies(startedLoad(), purchaseOrder, [startedLoad()])).to.equal(true);
  });

  it("blocks associates and other warehouse roles, even with the right phrase", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [startedLoad()],
      purchaseDocuments: [document()],
    });
    for (const actorRole of ["associate", "security-associate"]) {
      const result = cancelEnteredInboundPurchaseOrder(
        stored,
        PO_ID,
        cancelOptions({ actorRole, confirmText: INBOUND_CANCEL_CONFIRMATION }),
      );
      expect(result, actorRole).to.deep.equal({
        ok: false,
        error: ASSOCIATES_CANNOT_CANCEL,
      });
    }
    for (const actorRole of ["threepl", "project-manager", "driver", "user", ""]) {
      const result = cancelEnteredInboundPurchaseOrder(
        stored,
        PO_ID,
        cancelOptions({ actorRole }),
      );
      expect(result, actorRole).to.deep.equal({
        ok: false,
        error: MANAGERS_OR_COORDINATORS_CANCEL,
      });
    }
    expect(stored.purchaseOrders[0]?.lines).to.have.length(2);
    expect(stored.purchaseDocuments).to.have.length(1);
    expect(stored.receivingOrders[0]?.status).to.equal("in-progress");
    expect(stored.transactions).to.have.length(0);
  });

  it("rejects a missing or mistyped confirmation before it changes the purchase order", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [startedLoad()],
      purchaseDocuments: [document()],
    });
    for (const confirmText of [
      "cancelrightmeow",
      "CancelRightMeow ",
      " CancelRightMeow",
      "DELETE",
      "DeleteThisMeow",
      "",
    ]) {
      const result = cancelEnteredInboundPurchaseOrder(
        stored,
        PO_ID,
        cancelOptions({ actorRole: "coordinator", confirmText }),
      );
      expect(result, JSON.stringify(confirmText)).to.deep.equal({
        ok: false,
        error: TYPE_CANCEL_PHRASE,
      });
    }
    expect(stored.purchaseDocuments?.[0]?.id).to.equal(DOC_ID);
    expect(stored.purchaseOrders[0]?.expectationStatus).to.equal("expected");
  });

  it("refuses the phrase when receiving has not started or putaway is already posted", () => {
    const draft = startedLoad();
    draft.status = "draft";
    const waiting = system({
      purchaseOrders: [buyer()],
      receivingOrders: [draft],
    });
    expect(
      cancelEnteredInboundPurchaseOrder(waiting, PO_ID, cancelOptions()),
    ).to.deep.equal({ ok: false, error: PO_NOT_IN_RECEIVING });

    const posted = startedLoad();
    posted.pallets[0]!.cases[0]!.putawayPostedAt = NOW;
    posted.pallets[0]!.cases[0]!.putawayLocationId = LOC_ID;
    const onHand = system({
      purchaseOrders: [buyer()],
      receivingOrders: [posted],
      purchaseDocuments: [document()],
    });
    expect(
      cancelEnteredInboundPurchaseOrder(onHand, PO_ID, cancelOptions({ actorRole: "security-manager" })),
    ).to.deep.equal({ ok: false, error: PO_HAS_ON_HAND });
    expect(onHand.purchaseDocuments).to.have.length(1);
    expect(onHand.receivingOrders[0]?.status).to.equal("in-progress");
  });

  it("lets a manager or coordinator cancel and wipe parsed entries and the PDF", () => {
    for (const actorRole of ["manager", "coordinator", "security-manager"] as const) {
      const load = startedLoad();
      load.pallets.push({
        id: PALLET_TWO,
        palletNumber: "PLT-2",
        trackingNumber: "",
        isPartial: false,
        partialedBy: null,
        expectedSkuCount: 1,
        actualSkuCount: 1,
        expectedCaseCount: 1,
        actualCaseCount: 1,
        cubeRoute: null,
        cases: [
          {
            id: "88888888-8888-4888-8888-888888888890",
            upc: "010000000003",
            sku: "SCANNED-SKU",
            batch: null,
            quantityInCase: 1,
            description: "Scanned on the dock",
            manufacturer: "",
            color: null,
            fiber: null,
            putawayRoomId: null,
            putawayLocationId: null,
            putawayPostedAt: null,
          },
        ],
      });
      load.intake = "dock";
      const stored = system({
        purchaseOrders: [buyer()],
        receivingOrders: [load],
        purchaseDocuments: [document()],
      });
      const result = cancelEnteredInboundPurchaseOrder(
        stored,
        PO_ID,
        cancelOptions({ actorRole }),
      );
      expect(result, actorRole).to.deep.equal({ ok: true, documentIds: [DOC_ID] });
      expect(stored.purchaseOrders[0]).to.include({
        expectationStatus: "cancelled",
        jobIdNumber: "JOB-42",
        vendor: "Corning",
      });
      expect(stored.purchaseOrders[0]?.lines).to.deep.equal([]);
      expect(stored.purchaseDocuments).to.deep.equal([]);
      expect(stored.receivingOrders[0]?.status).to.equal("cancelled");
      expect(stored.receivingOrders[0]?.pallets[0]?.cases).to.deep.equal([]);
      expect(stored.receivingOrders[0]?.pallets[1]?.cases[0]?.sku).to.equal("SCANNED-SKU");
      expect(stored.transactions[0]).to.include({
        type: "inbound-po-cancel",
        sku: "PO-100",
        referenceType: "purchase-order",
        referenceId: PO_ID,
        createdBy: ACTOR_ID,
      });
      const again = cancelEnteredInboundPurchaseOrder(
        stored,
        PO_ID,
        cancelOptions({ actorRole }),
      );
      expect(again).to.deep.equal({ ok: false, error: PO_ALREADY_CANCELLED });
      expect(stored.transactions).to.have.length(1);
    }
  });

  it("clears every parsed case on an expected intake and lets a coordinator stage the PO again", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [startedLoad()],
      purchaseDocuments: [document()],
    });
    const blocked = updateInboundEntry(stored, {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      projectId: "PRJ-9",
      jobIdNumber: "JOB-42",
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
      expectationStatus: "cancelled",
      expectedPalletCount: 1,
      lines: buyer().lines ?? [],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(blocked).to.deep.equal({ ok: false, error: INBOUND_CANCEL_REQUIRES_BUTTON });
    expect(stored.purchaseOrders[0]?.lines).to.have.length(2);

    expect(cancelEnteredInboundPurchaseOrder(stored, PO_ID, cancelOptions()).ok).to.equal(true);
    expect(stored.receivingOrders[0]?.pallets[0]?.cases).to.deep.equal([]);

    const restored = updateInboundEntry(stored, {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      projectId: "PRJ-9",
      jobIdNumber: "JOB-42",
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
      expectationStatus: "expected",
      expectedPalletCount: 1,
      lines: [
        {
          id: LINE_ID,
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          description: "LC jumper",
          quantity: 4,
        },
      ],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(restored.ok).to.equal(true);
    const staged = stored.receivingOrders.find(
      (order) => order.intake === "expected" && order.status === "draft",
    );
    expect(staged?.pallets[0]?.cases[0]?.sku).to.equal("FBR-LC-12-100");
    expect(stored.receivingOrders.some((order) => order.status === "cancelled")).to.equal(true);
    expect(stored.purchaseOrders[0]?.expectationStatus).to.equal("expected");
  });

  it("reopens a cancelled purchase order when a coordinator reads a new PDF with lines", () => {
    const orders = [buyer()];
    orders[0]!.expectationStatus = "cancelled";
    orders[0]!.lines = [];
    const revived = applyRecognizedPurchase(
      orders,
      {
        purchaseOrderNumber: "PO-100",
        jobIdNumber: null,
        projectId: "PRJ-9",
        vendor: "Corning",
        carrier: "Estes",
        buyerName: "Morgan Coordinator",
        expectedArrivalAt: NOW,
        expectedPalletCount: 1,
        shipTo: null,
        lines: [
          {
            sku: "FBR-LC-12-100",
            upc: "010000000001",
            description: "LC jumper",
            quantity: 4,
            unitPrice: null,
            extendedPrice: null,
          },
        ],
        source: "embedded-text",
        note: "Read from text embedded in the PDF.",
      },
      {
        id: PO_ID,
        now: NOW,
        uploadedBy: "Morgan Coordinator",
        nextLineId: () => LINE_ID,
      },
    );
    expect(revived.expectationStatus).to.equal("expected");
    expect(revived.lines?.[0]?.sku).to.equal("FBR-LC-12-100");
    expect(revived.jobIdNumber).to.equal("JOB-42");
  });

  it("partials an opened inbound pallet only when inventory is still missing", () => {
    const full = startedLoad();
    full.status = "draft";
    expect(
      applyPartialInboundPallet({
        order: full,
        palletId: PALLET_ID,
        partialedBy: "Jordan Associate",
        expectedLines: buyer().lines ?? [],
        now: NOW,
      }),
    ).to.deep.equal({ ok: false, error: PALLET_NOT_SHORT });
    expect(full.pallets[0]?.isPartial).to.equal(false);
    expect(full.status).to.equal("draft");

    const dock = startedLoad();
    dock.intake = "dock";
    dock.pallets[0]!.cases.pop();
    expect(
      applyPartialInboundPallet({
        order: dock,
        palletId: PALLET_ID,
        partialedBy: "Jordan Associate",
        expectedLines: buyer().lines ?? [],
        now: NOW,
      }),
    ).to.deep.equal({ ok: false, error: PALLET_NOT_OPENED });

    const short = startedLoad();
    short.pallets[0]!.cases.pop();
    const unnamed = applyPartialInboundPallet({
      order: short,
      palletId: PALLET_ID,
      partialedBy: "  ",
      expectedLines: buyer().lines ?? [],
      now: NOW,
    });
    expect(unnamed).to.deep.equal({ ok: false, error: PARTIAL_NAME });

    const partialed = applyPartialInboundPallet({
      order: short,
      palletId: PALLET_ID,
      partialedBy: "Jordan Associate",
      expectedLines: buyer().lines ?? [],
      now: NOW,
    });
    expect(partialed).to.deep.equal({ ok: true });
    expect(short.status).to.equal("in-progress");
    expect(short.isPartialed).to.equal(true);
    expect(short.partialedBy).to.equal("Jordan Associate");
    expect(short.pallets[0]).to.include({
      isPartial: true,
      partialedBy: "Jordan Associate",
      actualCaseCount: 1,
    });
    expect(
      applyPartialInboundPallet({
        order: short,
        palletId: PALLET_ID,
        partialedBy: "Someone Else",
        expectedLines: buyer().lines ?? [],
        now: NOW,
      }),
    ).to.deep.equal({ ok: false, error: PALLET_ALREADY_PARTIAL });
    expect(short.partialedBy).to.equal("Jordan Associate");
  });

  it("partials a pallet when the case arrived but the quantity is short of the purchase order", () => {
    const load = startedLoad();
    load.pallets[0]!.cases[0]!.quantityInCase = 1;
    const lines = backorderLinesForShipment(load, buyer().lines ?? []);
    expect(lines.map((line) => line.sku)).to.deep.equal(["FBR-LC-12-100"]);
    expect(lines[0]).to.include({ expectedQuantity: 4, receivedQuantity: 1 });
    expect(
      applyPartialInboundPallet({
        order: load,
        palletId: PALLET_ID,
        partialedBy: "Jordan Associate",
        expectedLines: buyer().lines ?? [],
        now: NOW,
      }).ok,
    ).to.equal(true);
  });

  it("completes a short shipment only after the backorder is confirmed", () => {
    const load = startedLoad();
    load.pallets[0]!.cases.pop();
    const purchaseOrder = buyer();
    const refused = finishReceivingShipment(load, purchaseOrder, {
      acknowledgeBackorder: false,
      now: NOW,
    });
    expect(refused).to.deep.equal({ ok: false, error: BACKORDER_CONFIRM });
    expect(load.status).to.equal("in-progress");
    expect(load.backorderLines).to.deep.equal([]);

    const completed = finishReceivingShipment(load, purchaseOrder, {
      acknowledgeBackorder: true,
      now: NOW,
    });
    expect(completed.ok).to.equal(true);
    expect(load.status).to.equal("received");
    expect(load.backorderLines).to.deep.equal([
      {
        sku: "FBR-SC-6-50",
        description: "SC jumper",
        expectedQuantity: 2,
        receivedQuantity: 0,
      },
    ]);
    expect(load.workingPalletId).to.equal(null);
  });

  it("completes a full shipment without a backorder acknowledgement", () => {
    const load = startedLoad();
    const completed = finishReceivingShipment(load, buyer(), {
      acknowledgeBackorder: false,
      now: NOW,
    });
    expect(completed).to.deep.include({ ok: true });
    expect(load.status).to.equal("received");
    expect(load.backorderLines).to.deep.equal([]);
  });

  it("still refuses to complete a shipment that has no received cases", () => {
    const empty = startedLoad();
    empty.pallets[0]!.cases = [];
    expect(
      finishReceivingShipment(empty, buyer(), { acknowledgeBackorder: true, now: NOW }),
    ).to.deep.equal({ ok: false, error: RECEIVE_ONE_CASE });
    expect(empty.status).to.equal("in-progress");

    const partialed = startedLoad();
    partialed.pallets[0]!.cases[0]!.putawayPostedAt = NOW;
    partialed.pallets[0]!.cases.pop();
    expect(
      finishReceivingShipment(partialed, buyer(), {
        acknowledgeBackorder: true,
        now: NOW,
      }),
    ).to.deep.equal({ ok: false, error: RECEIVE_ONE_MORE });
  });

  it("keeps backorder lines when a receiving row is mapped from Postgres", () => {
    const mapped = mapReceivingOrder({
      id: LOAD_ID,
      po_number: "PO-100",
      received_at: NOW,
      vendor: "Corning",
      order_number: "EXP-PO-100",
      carrier_inbound: "Estes",
      receiver_name: "Jordan Associate",
      load_pallet_count: 1,
      status: "received",
      is_partialed: true,
      partialed_at: NOW,
      partialed_by: "Jordan Associate",
      reopened_at: null,
      reopened_by: null,
      working_pallet_id: null,
      pallets: [],
      notes: null,
      created_at: NOW,
      updated_at: NOW,
      created_by: "Jordan Associate",
      intake: "expected",
      backorder_lines: [
        {
          sku: "FBR-SC-6-50",
          description: "SC jumper",
          expectedQuantity: 2,
          receivedQuantity: 0,
        },
      ],
    });
    expect(mapped.backorderLines).to.deep.equal([
      {
        sku: "FBR-SC-6-50",
        description: "SC jumper",
        expectedQuantity: 2,
        receivedQuantity: 0,
      },
    ]);
    expect(mapReceivingOrder({
      id: LOAD_ID,
      po_number: "PO-100",
      received_at: NOW,
      vendor: "Corning",
      order_number: "EXP-PO-100",
      carrier_inbound: "Estes",
      receiver_name: "Jordan Associate",
      load_pallet_count: 1,
      status: "draft",
      is_partialed: false,
      partialed_at: null,
      partialed_by: null,
      reopened_at: null,
      reopened_by: null,
      working_pallet_id: null,
      pallets: [],
      notes: null,
      created_at: NOW,
      updated_at: NOW,
      created_by: null,
    }).backorderLines).to.deep.equal([]);
  });

  it("does not stage another expected load while a live receipt is still open", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [startedLoad()],
    });
    refreshExpectedLoad(stored, {
      purchaseOrderNumber: "PO-100",
      vendor: "Corning",
      carrier: "Estes",
      palletCount: 1,
      lines: buyer().lines ?? [],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(stored.receivingOrders).to.have.length(1);
    expect(stored.receivingOrders[0]?.status).to.equal("in-progress");
  });
});

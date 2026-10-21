import { describe, it } from "mocha";
import { expect } from "chai";
import {
  DeleteInboundPurchaseOrderInputSchema,
  InventorySystemSchema,
  PurchaseDocumentSchema,
  UpdateInboundPurchaseOrderInputSchema,
  type InventorySystem,
  type PurchaseOrder,
} from "@/lib/inventory-schema";
import { buildExpectedInboundLoad } from "@/lib/documents/inbound-load";
import { deleteInboundEntry, updateInboundEntry } from "@/lib/inbound/entry";
import { saveBuyerPurchaseOrder } from "@/lib/purchase-orders";

const NOW = "2026-10-21T15:00:00.000Z";
const PO_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const LINE_ID = "33333333-3333-4333-8333-333333333333";
const DOC_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DOC_ID = "55555555-5555-4555-8555-555555555555";
const LOAD_ID = "66666666-6666-4666-8666-666666666666";
const PALLET_ID = "77777777-7777-4777-8777-777777777777";
const CASE_ID = "88888888-8888-4888-8888-888888888888";

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
  receivingOrders?: InventorySystem["receivingOrders"];
  purchaseDocuments?: InventorySystem["purchaseDocuments"];
}): InventorySystem {
  return InventorySystemSchema.parse(partial);
}

function buyer(overrides?: Partial<Parameters<typeof saveBuyerPurchaseOrder>[1]>) {
  const orders: PurchaseOrder[] = [];
  saveBuyerPurchaseOrder(orders, {
    id: PO_ID,
    purchaseOrderNumber: "PO-100",
    generatedAt: NOW,
    projectId: "PRJ-9",
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
        sku: "BAD-SKU",
        upc: "",
        description: "Wrong description",
        quantity: 1,
      },
    ],
    uploadedBy: "Morgan Coordinator",
    ...overrides,
  });
  return orders[0];
}

function document(purchaseOrderNumber: string, id: string) {
  return PurchaseDocumentSchema.parse({
    id,
    purchaseOrderNumber,
    kind: "purchase-order",
    originalName: "po.pdf",
    mimeType: "application/pdf",
    size: 1200,
    pricesRedacted: true,
    recognitionSource: "embedded-text",
    recognitionNote: "Read from text embedded in the PDF.",
    lines: [
      {
        sku: "BAD-SKU",
        upc: "",
        description: "Wrong description",
        quantity: 1,
        unitPrice: null,
        extendedPrice: null,
      },
    ],
    createdAt: NOW,
  });
}

function expectedLoad(purchaseOrderNumber = "PO-100") {
  return buildExpectedInboundLoad({
    id: LOAD_ID,
    palletId: PALLET_ID,
    caseIds: [CASE_ID],
    now: NOW,
    purchaseOrderNumber,
    vendor: "Corning",
    carrier: "Estes",
    palletCount: 1,
    receiverName: "Morgan Coordinator",
    lines: [
      {
        sku: "BAD-SKU",
        upc: "NA",
        description: "Wrong description",
        quantity: 1,
      },
    ],
    existingOrderNumbers: [],
  });
}

describe("inbound purchase order corrections", () => {
  it("updates the parsed fields and the expected receiving load", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [expectedLoad()],
      purchaseDocuments: [document("PO-100", DOC_ID)],
    });
    const result = updateInboundEntry(stored, {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      projectId: "PRJ-9",
      jobIdNumber: "JOB-42",
      vendor: "CommScope",
      carrier: "XPO",
      expectedArrivalAt: "2026-10-22T12:00:00.000Z",
      buyerName: "Morgan Coordinator",
      notes: "Saltbox ATL",
      expectationStatus: "in-transit",
      expectedPalletCount: 2,
      lines: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sku: "C9300-24P",
          upc: "",
          description: "Catalyst 24 port",
          quantity: 4,
        },
      ],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(result.ok).to.equal(true);
    if (!result.ok) return;
    expect(result.purchaseOrder.vendor).to.equal("CommScope");
    expect(result.purchaseOrder.carrier).to.equal("XPO");
    expect(result.purchaseOrder.jobIdNumber).to.equal("JOB-42");
    expect(result.purchaseOrder.expectationNotes).to.equal("Saltbox ATL");
    expect(result.purchaseOrder.lines?.[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
    });
    expect(stored.receivingOrders[0].poNumber).to.equal("PO-100");
    expect(stored.receivingOrders[0].vendor).to.equal("CommScope");
    expect(stored.receivingOrders[0].orderNumber).to.equal("EXP-PO-100");
    expect(stored.receivingOrders[0].pallets[0].cases[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantityInCase: 4,
    });
    expect(stored.purchaseDocuments?.[0].lines[0].sku).to.equal("C9300-24P");
    expect(stored.purchaseDocuments?.[0].jobIdNumber).to.equal("JOB-42");
  });

  it("refuses a PO number that already belongs to another entry", () => {
    const stored = system({
      purchaseOrders: [
        buyer(),
        buyer({
          id: OTHER_ID,
          purchaseOrderNumber: "PO-200",
          lines: [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              sku: "KEEP",
              upc: "",
              description: "Leave this",
              quantity: 2,
            },
          ],
        }),
      ],
    });
    const result = updateInboundEntry(stored, {
      id: PO_ID,
      purchaseOrderNumber: "PO-200",
      projectId: null,
      jobIdNumber: null,
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
      expectationStatus: "expected",
      expectedPalletCount: 1,
      lines: [
        {
          id: LINE_ID,
          sku: "BAD-SKU",
          upc: "",
          description: "Wrong description",
          quantity: 1,
        },
      ],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(result.ok).to.equal(false);
    expect(stored.purchaseOrders.map((order) => order.purchaseOrderNumber)).to.deep.equal([
      "PO-100",
      "PO-200",
    ]);
  });

  it("renames linked records without rewriting freight the dock already started", () => {
    const started = expectedLoad();
    started.status = "in-progress";
    started.intake = "dock";
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [started],
    });
    const result = updateInboundEntry(stored, {
      id: PO_ID,
      purchaseOrderNumber: "PO-101",
      projectId: null,
      jobIdNumber: null,
      vendor: "CommScope",
      carrier: "XPO",
      expectedArrivalAt: NOW,
      expectationStatus: "expected",
      expectedPalletCount: 1,
      lines: [
        {
          id: LINE_ID,
          sku: "C9300-24P",
          upc: "",
          description: "Catalyst 24 port",
          quantity: 4,
        },
      ],
      now: NOW,
      nextId: nextIdFactory(),
    });
    expect(result.ok).to.equal(true);
    expect(stored.purchaseOrders[0].purchaseOrderNumber).to.equal("PO-101");
    expect(stored.receivingOrders).to.have.length(1);
    expect(stored.receivingOrders[0].poNumber).to.equal("PO-101");
    expect(stored.receivingOrders[0].status).to.equal("in-progress");
    expect(stored.receivingOrders[0].pallets[0].cases[0].sku).to.equal("BAD-SKU");
  });

  it("deletes one invalid entry and leaves the other purchase order", () => {
    const stored = system({
      purchaseOrders: [
        buyer(),
        buyer({
          id: OTHER_ID,
          purchaseOrderNumber: "PO-200",
        }),
      ],
      receivingOrders: [expectedLoad("PO-100"), expectedLoad("PO-200")],
      purchaseDocuments: [document("PO-100", DOC_ID), document("PO-200", OTHER_DOC_ID)],
    });
    stored.receivingOrders[1].id = "99999999-9999-4999-8999-999999999991";
    const result = deleteInboundEntry(stored, PO_ID);
    expect(result.ok).to.equal(true);
    if (!result.ok) return;
    expect(result.documentIds).to.deep.equal([DOC_ID]);
    expect(stored.purchaseOrders.map((order) => order.purchaseOrderNumber)).to.deep.equal([
      "PO-200",
    ]);
    expect(stored.receivingOrders.map((order) => order.poNumber)).to.deep.equal(["PO-200"]);
    expect(stored.purchaseDocuments?.map((entry) => entry.id)).to.deep.equal([OTHER_DOC_ID]);
  });

  it("refuses to delete a purchase order the dock has already started", () => {
    const started = expectedLoad();
    started.status = "received";
    started.intake = "dock";
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [started],
      purchaseDocuments: [document("PO-100", DOC_ID)],
    });
    const result = deleteInboundEntry(stored, PO_ID);
    expect(result.ok).to.equal(false);
    expect(stored.purchaseOrders).to.have.length(1);
    expect(stored.receivingOrders).to.have.length(1);
    expect(stored.purchaseDocuments).to.have.length(1);
  });

  it("requires the word DELETE before the delete schema accepts the request", () => {
    expect(
      DeleteInboundPurchaseOrderInputSchema.safeParse({
        id: PO_ID,
        confirmText: "DELETE",
      }).success,
    ).to.equal(true);
    const rejected = DeleteInboundPurchaseOrderInputSchema.safeParse({
      id: PO_ID,
      confirmText: "delete",
    });
    expect(rejected.success).to.equal(false);
    expect(
      UpdateInboundPurchaseOrderInputSchema.safeParse({
        id: PO_ID,
        purchaseOrderNumber: "PO-100",
        vendor: "Corning",
        carrier: "Estes",
        expectedArrivalAt: NOW,
        lines: [{ sku: "", upc: "", description: "", quantity: 1 }],
      }).success,
    ).to.equal(false);
  });
});

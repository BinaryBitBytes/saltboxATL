import { describe, it } from "mocha";
import { expect } from "chai";
import {
  DeleteInboundPurchaseOrderInputSchema,
  INBOUND_DELETE_CONFIRMATION,
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
const EXTRA_DOC_ID = "99999999-9999-4999-8999-999999999992";
const MISSING_ID = "12121212-1212-4212-8212-121212121212";
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

function correction(
  overrides: Partial<Parameters<typeof updateInboundEntry>[1]> = {},
): Parameters<typeof updateInboundEntry>[1] {
  return {
    id: PO_ID,
    purchaseOrderNumber: "PO-100",
    projectId: "PRJ-9",
    jobIdNumber: null,
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
    now: NOW,
    nextId: nextIdFactory(),
    ...overrides,
  };
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
    expect(stored.receivingOrders[0].id).to.equal(LOAD_ID);
    expect(stored.receivingOrders[0].poNumber).to.equal("PO-100");
    expect(stored.receivingOrders[0].vendor).to.equal("CommScope");
    expect(stored.receivingOrders[0].carrierInbound).to.equal("XPO");
    expect(stored.receivingOrders[0].receiverName).to.equal("Morgan Coordinator");
    expect(stored.receivingOrders[0].loadPalletCount).to.equal(2);
    expect(stored.receivingOrders[0].orderNumber).to.equal("EXP-PO-100");
    expect(stored.receivingOrders[0].status).to.equal("draft");
    expect(stored.receivingOrders[0].intake).to.equal("expected");
    expect(stored.receivingOrders[0].pallets[0].id).to.equal(PALLET_ID);
    expect(stored.receivingOrders[0].pallets[0].cases[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantityInCase: 4,
    });
    expect(stored.purchaseDocuments?.[0].lines[0].sku).to.equal("C9300-24P");
    expect(stored.purchaseDocuments?.[0].lines[0].unitPrice).to.equal(null);
    expect(stored.purchaseDocuments?.[0].lines[0].extendedPrice).to.equal(null);
    expect(stored.purchaseDocuments?.[0].jobIdNumber).to.equal("JOB-42");
  });

  it("refuses a PO number that already belongs to another entry", () => {
    const original = buyer();
    original.jobIdNumber = "JOB-KEEP";
    const stored = system({
      purchaseOrders: [
        original,
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
    const result = updateInboundEntry(
      stored,
      correction({
        purchaseOrderNumber: "PO-200",
        jobIdNumber: "JOB-NEW",
        vendor: "CommScope",
        lines: [
          {
            id: LINE_ID,
            sku: "C9300-24P",
            upc: "",
            description: "Catalyst 24 port",
            quantity: 4,
          },
        ],
      }),
    );
    expect(result).to.deep.equal({
      ok: false,
      error: "Another inbound entry already uses that PO number.",
    });
    expect(stored.purchaseOrders[0]).to.include({
      purchaseOrderNumber: "PO-100",
      vendor: "Corning",
      jobIdNumber: "JOB-KEEP",
    });
    expect(stored.purchaseOrders[0].lines?.[0].sku).to.equal("BAD-SKU");
    expect(stored.purchaseOrders[1]).to.include({
      purchaseOrderNumber: "PO-200",
      vendor: "Corning",
    });
    expect(stored.purchaseOrders[1].lines?.[0].sku).to.equal("KEEP");
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
    expect(stored.receivingOrders[0].intake).to.equal("dock");
    expect(stored.receivingOrders[0].vendor).to.equal("Corning");
    expect(stored.receivingOrders[0].pallets[0].cases[0].sku).to.equal("BAD-SKU");
    expect(stored.receivingOrders[0].pallets[0].cases[0].description).to.equal(
      "Wrong description",
    );
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
    expect(result).to.deep.equal({
      ok: false,
      error: "This purchase order already has freight on the dock, so it cannot be deleted.",
    });
    expect(stored.purchaseOrders).to.have.length(1);
    expect(stored.receivingOrders).to.have.length(1);
    expect(stored.purchaseDocuments).to.have.length(1);
  });

  it("leaves every record alone when the inbound entry id is missing", () => {
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [expectedLoad()],
      purchaseDocuments: [document("PO-100", DOC_ID)],
    });
    const updated = updateInboundEntry(stored, correction({ id: MISSING_ID }));
    expect(updated).to.deep.equal({
      ok: false,
      error: "That inbound purchase order was not found.",
    });
    const deleted = deleteInboundEntry(stored, MISSING_ID);
    expect(deleted).to.deep.equal({
      ok: false,
      error: "That inbound purchase order was not found.",
    });
    expect(stored.purchaseOrders[0]).to.include({
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      vendor: "Corning",
    });
    expect(stored.receivingOrders.map((order) => order.poNumber)).to.deep.equal(["PO-100"]);
    expect(stored.purchaseDocuments?.map((entry) => entry.id)).to.deep.equal([DOC_ID]);
  });

  it("clears a job ID when the correction leaves it blank", () => {
    const order = buyer();
    order.jobIdNumber = "JOB-42";
    const stored = system({ purchaseOrders: [order] });
    const result = updateInboundEntry(stored, correction({ jobIdNumber: null }));
    expect(result.ok).to.equal(true);
    if (!result.ok) return;
    expect(result.purchaseOrder.jobIdNumber).to.equal(null);
  });

  it("stages an expected receiving load when the purchase order has none yet", () => {
    const stored = system({ purchaseOrders: [buyer()] });
    const result = updateInboundEntry(
      stored,
      correction({
        vendor: "CommScope",
        carrier: "XPO",
        lines: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            sku: "C9300-24P",
            upc: "",
            description: "Catalyst 24 port",
            quantity: 4,
          },
        ],
      }),
    );
    expect(result.ok).to.equal(true);
    expect(stored.receivingOrders).to.have.length(1);
    expect(stored.receivingOrders[0]).to.include({
      id: "99999999-9999-4999-8999-000000000001",
      poNumber: "PO-100",
      orderNumber: "EXP-PO-100",
      vendor: "CommScope",
      carrierInbound: "XPO",
      receiverName: "Expected Receiver",
      status: "draft",
      intake: "expected",
    });
    expect(stored.receivingOrders[0].pallets[0].cases[0].sku).to.equal("C9300-24P");
  });

  it("renames the expected load and the PDF, and clears prices stored on the PDF lines", () => {
    const pdf = document("PO-100", DOC_ID);
    pdf.jobIdNumber = "JOB-OLD";
    pdf.lines[0].unitPrice = "12.50";
    pdf.lines[0].extendedPrice = "$48.00";
    const other = document("PO-200", OTHER_DOC_ID);
    other.jobIdNumber = "JOB-OTHER";
    const stored = system({
      purchaseOrders: [buyer(), buyer({ id: OTHER_ID, purchaseOrderNumber: "PO-200" })],
      receivingOrders: [expectedLoad()],
      purchaseDocuments: [pdf, other],
    });
    const result = updateInboundEntry(
      stored,
      correction({
        purchaseOrderNumber: "PO-101",
        jobIdNumber: "JOB-42",
        vendor: "CommScope",
        carrier: "XPO",
        expectedPalletCount: 2,
        lines: [
          {
            id: LINE_ID,
            sku: "C9300-24P",
            upc: "",
            description: "Catalyst 24 port",
            quantity: 4,
          },
        ],
      }),
    );
    expect(result.ok).to.equal(true);
    expect(stored.receivingOrders[0]).to.include({
      id: LOAD_ID,
      poNumber: "PO-101",
      orderNumber: "EXP-PO-100",
      vendor: "CommScope",
      carrierInbound: "XPO",
      receiverName: "Morgan Coordinator",
      loadPalletCount: 2,
      status: "draft",
      intake: "expected",
    });
    expect(stored.receivingOrders[0].pallets[0].id).to.equal(PALLET_ID);
    const moved = stored.purchaseDocuments?.find((entry) => entry.id === DOC_ID);
    expect(moved?.purchaseOrderNumber).to.equal("PO-101");
    expect(moved?.jobIdNumber).to.equal("JOB-42");
    expect(moved?.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
      unitPrice: null,
      extendedPrice: null,
    });
    const untouched = stored.purchaseDocuments?.find((entry) => entry.id === OTHER_DOC_ID);
    expect(untouched?.purchaseOrderNumber).to.equal("PO-200");
    expect(untouched?.jobIdNumber).to.equal("JOB-OTHER");
    expect(untouched?.lines[0].sku).to.equal("BAD-SKU");
    expect(untouched?.lines[0].unitPrice).to.equal(null);
  });

  it("rebuilds only the unchecked expected load when freight is already on the dock", () => {
    const expected = expectedLoad();
    const started = expectedLoad();
    started.id = "99999999-9999-4999-8999-999999999993";
    started.status = "in-progress";
    started.intake = "dock";
    started.workingPalletId = "99999999-9999-4999-8999-999999999994";
    started.pallets[0].id = "99999999-9999-4999-8999-999999999994";
    started.pallets[0].cases[0].id = "99999999-9999-4999-8999-999999999995";
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [expected, started],
    });
    const result = updateInboundEntry(
      stored,
      correction({
        purchaseOrderNumber: "PO-101",
        vendor: "CommScope",
        lines: [
          {
            id: LINE_ID,
            sku: "C9300-24P",
            upc: "",
            description: "Catalyst 24 port",
            quantity: 4,
          },
        ],
      }),
    );
    expect(result.ok).to.equal(true);
    expect(stored.receivingOrders).to.have.length(2);
    expect(stored.receivingOrders[0]).to.include({
      id: LOAD_ID,
      poNumber: "PO-101",
      vendor: "CommScope",
      intake: "expected",
      status: "draft",
    });
    expect(stored.receivingOrders[0].pallets[0].cases[0].sku).to.equal("C9300-24P");
    expect(stored.receivingOrders[1]).to.include({
      id: "99999999-9999-4999-8999-999999999993",
      poNumber: "PO-101",
      vendor: "Corning",
      intake: "dock",
      status: "in-progress",
    });
    expect(stored.receivingOrders[1].pallets[0].cases[0].sku).to.equal("BAD-SKU");
  });

  it("returns every PDF id for the deleted purchase order", () => {
    const stored = system({
      purchaseOrders: [buyer(), buyer({ id: OTHER_ID, purchaseOrderNumber: "PO-200" })],
      receivingOrders: [expectedLoad("PO-100")],
      purchaseDocuments: [
        document("PO-100", DOC_ID),
        document("PO-100", EXTRA_DOC_ID),
        document("PO-200", OTHER_DOC_ID),
      ],
    });
    const result = deleteInboundEntry(stored, PO_ID);
    expect(result).to.deep.equal({ ok: true, documentIds: [DOC_ID, EXTRA_DOC_ID] });
    expect(stored.purchaseOrders.map((order) => order.purchaseOrderNumber)).to.deep.equal([
      "PO-200",
    ]);
    expect(stored.receivingOrders).to.have.length(0);
    expect(stored.purchaseDocuments?.map((entry) => entry.id)).to.deep.equal([OTHER_DOC_ID]);
  });

  it("refuses to delete a cancelled dock receipt and leaves the PDF", () => {
    const cancelled = expectedLoad();
    cancelled.status = "cancelled";
    cancelled.intake = "dock";
    const stored = system({
      purchaseOrders: [buyer()],
      receivingOrders: [cancelled],
      purchaseDocuments: [document("PO-100", DOC_ID)],
    });
    const result = deleteInboundEntry(stored, PO_ID);
    expect(result).to.deep.equal({
      ok: false,
      error: "This purchase order already has freight on the dock, so it cannot be deleted.",
    });
    expect(stored.purchaseOrders).to.have.length(1);
    expect(stored.receivingOrders[0].status).to.equal("cancelled");
    expect(stored.purchaseDocuments?.[0].id).to.equal(DOC_ID);
  });

  it("requires the exact word DELETE before the delete schema accepts the request", () => {
    expect(INBOUND_DELETE_CONFIRMATION).to.equal("DELETE");
    expect(
      DeleteInboundPurchaseOrderInputSchema.safeParse({
        id: PO_ID,
        confirmText: INBOUND_DELETE_CONFIRMATION,
      }).success,
    ).to.equal(true);
    for (const confirmText of ["delete", "DELETE ", " DELETE", ""]) {
      const rejected = DeleteInboundPurchaseOrderInputSchema.safeParse({
        id: PO_ID,
        confirmText,
      });
      expect(rejected.success, confirmText).to.equal(false);
    }
    const base = {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
    };
    expect(
      UpdateInboundPurchaseOrderInputSchema.safeParse({
        ...base,
        lines: [{ sku: "", upc: "", description: "", quantity: 1 }],
      }).success,
    ).to.equal(false);
    expect(
      UpdateInboundPurchaseOrderInputSchema.safeParse({
        ...base,
        lines: [{ sku: "C9300-24P", upc: "", description: "Catalyst", quantity: 0 }],
      }).success,
    ).to.equal(false);
    expect(
      UpdateInboundPurchaseOrderInputSchema.safeParse({
        ...base,
        lines: [{ sku: "BAD SKU", upc: "", description: "Catalyst", quantity: 1 }],
      }).success,
    ).to.equal(false);
    const descriptionOnly = UpdateInboundPurchaseOrderInputSchema.safeParse({
      ...base,
      lines: [{ sku: "", upc: "", description: "Catalyst 24 port", quantity: 1 }],
    });
    expect(descriptionOnly.success).to.equal(true);
    if (!descriptionOnly.success) return;
    expect(descriptionOnly.data.lines[0]).to.deep.include({
      sku: "",
      description: "Catalyst 24 port",
      quantity: 1,
    });
  });
});

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  CreateReceivingOrderInputSchema,
  InventorySystemSchema,
  PurchaseOrderSchema,
  type PurchaseOrder,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { upsertPurchaseOrder } from "@/lib/purchase-orders";
import { mapPurchaseOrder } from "@/backend/server/pg-mapper";
import { buildInboundLabels } from "@/lib/labels/build-labels";
import { buildLogbookEntries } from "@/lib/logbook/entries";
import {
  buildItemCatalog,
  itemReportToCsv,
  queryItemReport,
} from "@/lib/reports/item-report";

const PO_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOW = "2026-08-20T15:00:00.000Z";

const receiving = {
  id: "11111111-1111-4111-8111-111111111111",
  poNumber: "PO-88",
  orderNumber: "RCV-9",
  vendor: "Corning",
  receivedAt: NOW,
  carrierInbound: "XPO",
  receiverName: "Riley User",
  status: "received",
  pallets: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      palletNumber: "P1",
      cases: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          quantityInCase: 4,
          description: "LC fiber",
        },
      ],
    },
  ],
} as ReceivingOrder;

describe("purchase order job IDs", () => {
  it("keeps JobIDNumber optional on existing purchase orders", () => {
    const parsed = PurchaseOrderSchema.parse({
      id: PO_ID,
      purchaseOrderNumber: "PO-1",
      generatedAt: NOW,
    });
    expect(parsed.jobIdNumber).to.equal(null);

    const system = InventorySystemSchema.parse({
      purchaseOrders: [
        {
          id: PO_ID,
          purchaseOrderNumber: "PO-1",
          generatedAt: NOW,
        },
      ],
    });
    expect(system.purchaseOrders[0].jobIdNumber).to.equal(null);
  });

  it("stores a trimmed job ID and treats a blank value as unset", () => {
    expect(
      PurchaseOrderSchema.parse({
        id: PO_ID,
        purchaseOrderNumber: "PO-1",
        generatedAt: NOW,
        jobIdNumber: "  JOB-1042  ",
      }).jobIdNumber,
    ).to.equal("JOB-1042");

    const created = CreateReceivingOrderInputSchema.parse({
      poNumber: "PO-1",
      vendor: "Corning",
      orderNumber: "RCV-1",
      carrierInbound: "UPS",
      receiverName: "Avery Manager",
      jobIdNumber: "   ",
    });
    expect(created.jobIdNumber).to.equal(null);

    const omitted = CreateReceivingOrderInputSchema.parse({
      poNumber: "PO-1",
      vendor: "Corning",
      orderNumber: "RCV-1",
      carrierInbound: "UPS",
      receiverName: "Avery Manager",
    });
    expect(omitted.jobIdNumber).to.equal(null);

    const markup = PurchaseOrderSchema.safeParse({
      id: PO_ID,
      purchaseOrderNumber: "PO-1",
      generatedAt: NOW,
      jobIdNumber: "<b>JOB</b>",
    });
    expect(markup.success).to.equal(false);
  });

  it("attaches a job ID to a PO without clearing it when a later job omits it", () => {
    const orders: PurchaseOrder[] = [];
    upsertPurchaseOrder(orders, {
      id: PO_ID,
      purchaseOrderNumber: "PO-9",
      generatedAt: NOW,
      jobIdNumber: "JOB-9",
    });
    upsertPurchaseOrder(orders, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      purchaseOrderNumber: "PO-9",
      generatedAt: NOW,
      jobIdNumber: null,
    });
    expect(orders).to.have.length(1);
    expect(orders[0].jobIdNumber).to.equal("JOB-9");

    upsertPurchaseOrder(
      orders,
      {
        id: PO_ID,
        purchaseOrderNumber: "PO-9",
        generatedAt: NOW,
        jobIdNumber: "JOB-10",
      },
      { replaceJobId: true },
    );
    expect(orders[0].jobIdNumber).to.equal("JOB-10");

    upsertPurchaseOrder(
      orders,
      {
        id: PO_ID,
        purchaseOrderNumber: "PO-9",
        generatedAt: NOW,
        jobIdNumber: null,
      },
      { replaceJobId: true },
    );
    expect(orders[0].jobIdNumber).to.equal(null);
  });

  it("maps a nullable database column", () => {
    expect(
      mapPurchaseOrder({
        id: PO_ID,
        purchase_order_number: "PO-1",
        generated_at: NOW,
        created_at: null,
      }).jobIdNumber,
    ).to.equal(null);
    expect(
      mapPurchaseOrder({
        id: PO_ID,
        purchase_order_number: "PO-1",
        generated_at: NOW,
        created_at: NOW,
        job_id_number: " JOB-1 ",
      }).jobIdNumber,
    ).to.equal("JOB-1");
  });

  it("shows the job ID on labels, the logbook, and item reports", () => {
    const purchaseOrder: PurchaseOrder = {
      id: PO_ID,
      purchaseOrderNumber: "PO-88",
      generatedAt: NOW,
      jobIdNumber: "JOB-88",
    };
    const labels = buildInboundLabels(receiving, purchaseOrder.jobIdNumber);
    expect(labels[0].fields).to.deep.include({ label: "Job ID", value: "JOB-88" });

    const entries = buildLogbookEntries({
      receivingOrders: [receiving],
      shippingOrders: [],
      transactions: [],
      photos: [],
      locationCodes: new Map(),
      purchaseOrders: [purchaseOrder],
    });
    expect(entries[0].subtitle).to.include("Job JOB-88");

    const catalog = buildItemCatalog({
      inventoryItems: [],
      locations: [],
      rooms: [],
      receivingOrders: [receiving],
      shippingOrders: [],
      purchaseOrders: [purchaseOrder],
    });
    const report = queryItemReport(catalog, { jobIdNumber: "JOB-88" });
    expect(report.rows).to.have.length(1);
    expect(report.rows[0].jobIdNumber).to.equal("JOB-88");
    expect(itemReportToCsv(report)).to.include("Job ID");
    expect(itemReportToCsv(report)).to.include("JOB-88");
  });
});

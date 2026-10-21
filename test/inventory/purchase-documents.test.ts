import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "mocha";
import { expect } from "chai";
import {
  InventorySystemSchema,
  PurchaseDocumentSchema,
  type PurchaseOrder,
  type ReceivingOrder,
} from "@/lib/inventory-schema";
import { canAccessPath } from "@/lib/auth/permissions";
import { buildInboundForecast } from "@/lib/inbound/forecast";
import { saveBuyerPurchaseOrder } from "@/lib/purchase-orders";
import {
  blackOutPricingColumns,
  extractPdfText,
  isPdf,
  pricingBlackoutTokens,
  redactPdfBytes,
} from "@/lib/documents/pdf-text";
import {
  COMPOSIO_NOTE,
  EMBEDDED_NOTE,
  recognizePurchasePdf,
} from "@/lib/documents/recognize";
import {
  composioVisionArguments,
  executeComposioVision,
  textFromVisionPayload,
} from "@/lib/documents/composio-vision";
import {
  applyRecognizedPurchase,
  buyerLinesFromRecognition,
  inboundReviewFromRecognition,
} from "@/lib/documents/apply";
import { readPdfGlyphs } from "@/lib/documents/pdf-layout";
import { redactPositionedPrices } from "@/lib/documents/pdf-redact";
import {
  buildExpectedInboundLoad,
  invoiceImportError,
  pdfStillContainsPrices,
  receivableInvoiceLines,
  redactDocumentLines,
  stageExpectedReceivingOrder,
} from "@/lib/documents/inbound-load";
import { purchaseDocumentView } from "@/lib/documents/view";

const NOW = "2026-10-20T12:00:00.000Z";
const PO_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const LOAD_ID = "44444444-4444-4444-8444-444444444444";
const PALLET_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfDocument(lines: string[]): Uint8Array {
  const commands = ["BT", "/F1 12 Tf", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("0 -16 Td");
    commands.push(`(${escapePdf(line)}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const body = `%PDF-1.4
1 0 obj
<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}
endstream
endobj
trailer
<<>>
%%EOF
`;
  return new TextEncoder().encode(body);
}

const SAMPLE_LINES = [
  "PO Number: PO-100",
  "Job ID: JOB-42",
  "Project ID: PRJ-9",
  "Vendor: Corning",
  "Carrier: Estes",
  "Buyer: Morgan Coordinator",
  "Expected Arrival: 2026-10-20T12:00:00.000Z",
  "Pallets: 2",
  "SKU: FBR-LC-12-100 UPC: 010000000001 Description: LC 12ct fiber Qty: 12 Unit Price: $4.50 Amount: $54.00",
];

describe("purchase document recognition", () => {
  it("reads PO, job ID, and invoice prices from PDF text", async () => {
    const bytes = pdfDocument(SAMPLE_LINES);
    expect(isPdf(bytes)).to.equal(true);
    const recognized = await recognizePurchasePdf(bytes, { vision: null });
    expect(recognized.source).to.equal("embedded-text");
    expect(recognized.note).to.equal(EMBEDDED_NOTE);
    expect(recognized.purchaseOrderNumber).to.equal("PO-100");
    expect(recognized.jobIdNumber).to.equal("JOB-42");
    expect(recognized.projectId).to.equal("PRJ-9");
    expect(recognized.vendor).to.equal("Corning");
    expect(recognized.carrier).to.equal("Estes");
    expect(recognized.buyerName).to.equal("Morgan Coordinator");
    expect(recognized.expectedArrivalAt).to.equal(NOW);
    expect(recognized.expectedPalletCount).to.equal(2);
    expect(recognized.lines[0]).to.deep.include({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      description: "LC 12ct fiber",
      quantity: 12,
      unitPrice: "$4.50",
      extendedPrice: "$54.00",
    });
  });

  it("prefers Composio image recognition text when the PDF has no embedded words", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\ntrailer\n<<>>\n%%EOF\n");
    const recognized = await recognizePurchasePdf(bytes, {
      vision: async () => SAMPLE_LINES.join("\n"),
    });
    expect(recognized.source).to.equal("composio");
    expect(recognized.note).to.equal(COMPOSIO_NOTE);
    expect(recognized.purchaseOrderNumber).to.equal("PO-100");
    expect(recognized.jobIdNumber).to.equal("JOB-42");
    expect(recognized.lines).to.have.length(1);
  });

  it("maps MPN, vendor, PO number, job number, quantity, and description, and stores Ship To in notes", async () => {
    const bytes = pdfDocument([
      "Vendor: Corning",
      "PO #: PO-100",
      "Job Number: JOB-42",
      "Ship To:",
      "Saltbox ATL",
      "123 Dock Street",
      "Freight 12.50 and $48.00 prepaid",
      "MPN: C9300-24P SKU: IGNORE-SKU Description: Catalyst 24 port QTY: 4 Rate: 12.50 Amount: $48.00",
    ]);
    const recognized = await recognizePurchasePdf(bytes, { vision: null });
    expect(recognized.vendor).to.equal("Corning");
    expect(recognized.purchaseOrderNumber).to.equal("PO-100");
    expect(recognized.jobIdNumber).to.equal("JOB-42");
    expect(recognized.shipTo).to.equal(
      "Saltbox ATL\n123 Dock Street\nFreight 12.50 and $48.00 prepaid",
    );
    expect(recognized.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
      unitPrice: "12.50",
      extendedPrice: "$48.00",
    });
    expect(recognized.lines[0].sku).to.not.equal("IGNORE-SKU");
    expect(recognized.lines[0].upc).to.equal("");

    const orders: PurchaseOrder[] = [];
    const created = applyRecognizedPurchase(orders, recognized, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    expect(created.vendor).to.equal("Corning");
    expect(created.purchaseOrderNumber).to.equal("PO-100");
    expect(created.jobIdNumber).to.equal("JOB-42");
    expect(created.lines?.[0]).to.deep.include({
      sku: "C9300-24P",
      upc: "",
      description: "Catalyst 24 port",
      quantity: 4,
    });
    expect(created.expectationNotes).to.equal(
      "Saltbox ATL\n123 Dock Street\nFreight and prepaid",
    );
    expect(created.expectationNotes).to.not.include("JOB-42");

    const visible = JSON.stringify(buildInboundForecast(orders, []));
    expect(visible).to.not.include("12.50");
    expect(visible).to.not.include("$48.00");
    expect(visible).to.not.include("IGNORE-SKU");
    expect(visible).to.include("C9300-24P");
    expect(visible).to.include("Saltbox ATL");
  });

  it("blacks out Rate and Amount in the PDF, then fills vendor, buyer, job, and expected contents", async () => {
    const bytes = pdfDocument([
      "Vendor:",
      "Corning",
      "Buyer Name:",
      "Morgan Coordinator",
      "Job ID:",
      "JOB-42",
      "PO Number:",
      "PO-100",
      "MPN Description Qty Rate Amount",
      "C9300-24P Catalyst 24 port 4 12.50 $48.00",
    ]);
    const recognized = await recognizePurchasePdf(bytes, { vision: null });
    expect(recognized.vendor).to.equal("Corning");
    expect(recognized.buyerName).to.equal("Morgan Coordinator");
    expect(recognized.jobIdNumber).to.equal("JOB-42");
    expect(recognized.purchaseOrderNumber).to.equal("PO-100");
    expect(recognized.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
      unitPrice: "12.50",
      extendedPrice: "$48.00",
    });

    const stored = blackOutPricingColumns(bytes, pricingBlackoutTokens(recognized.lines));
    const storedText = extractPdfText(stored);
    expect(stored.byteLength).to.equal(bytes.byteLength);
    expect(storedText).to.include("C9300-24P");
    expect(storedText).to.include("Catalyst 24 port");
    expect(storedText).to.include("Corning");
    expect(storedText).to.include("Morgan Coordinator");
    expect(storedText).to.match(/\bRate\b/);
    expect(storedText).to.match(/\bAmount\b/);
    expect(storedText).to.include("#####");
    expect(storedText).to.include("######");
    expect(storedText).to.not.include("12.50");
    expect(storedText).to.not.include("$48.00");

    const orders: PurchaseOrder[] = [];
    const created = applyRecognizedPurchase(orders, recognized, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    expect(created.vendor).to.equal("Corning");
    expect(created.buyerName).to.equal("Morgan Coordinator");
    expect(created.jobIdNumber).to.equal("JOB-42");
    expect(created.lines?.[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
    });

    const receiving: ReceivingOrder[] = [];
    const contents = receivableInvoiceLines(recognized.lines);
    const load = stageExpectedReceivingOrder(receiving, {
      id: LOAD_ID,
      palletId: PALLET_ID,
      caseIds: [CASE_ID],
      now: NOW,
      purchaseOrderNumber: created.purchaseOrderNumber,
      vendor: created.vendor || "Corning",
      carrier: "Estes",
      palletCount: 1,
      receiverName: "Morgan Coordinator",
      lines: contents,
      existingOrderNumbers: [],
    });
    expect(load?.intake).to.equal("expected");
    expect(load?.pallets[0].cases[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantityInCase: 4,
    });
    expect(JSON.stringify(load)).to.not.include("12.50");
    expect(JSON.stringify(load)).to.not.include("$48.00");
    expect(JSON.stringify(buildInboundForecast(orders, receiving))).to.not.include("$");
  });

  it("keeps column order and does not turn the following prose into a line", async () => {
    const bytes = pdfDocument([
      "Vendor:",
      "Corning",
      "PO Number: PO-100",
      "Ship To:",
      "Saltbox ATL",
      "Line Description MPN Qty Amount Rate",
      "1 Catalyst 24 port C9300-24P 4 $48.00 12.50",
      "Please deliver to dock 4 by 10.00",
    ]);
    const recognized = await recognizePurchasePdf(bytes, { vision: null });
    expect(recognized.vendor).to.equal("Corning");
    expect(recognized.shipTo).to.equal("Saltbox ATL");
    expect(recognized.lines).to.have.length(1);
    expect(recognized.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
      unitPrice: "12.50",
      extendedPrice: "$48.00",
    });
    expect(JSON.stringify(recognized.lines)).to.not.include("Please");
    expect(JSON.stringify(recognized.lines)).to.not.include("deliver");
  });

  it("stops the item table at the first row that does not match and does not resume", async () => {
    const recognized = await recognizePurchasePdf(
      pdfDocument([
        "PO Number: PO-100",
        "MPN Description Qty Rate Amount",
        "C9300-24P Catalyst 24 port 4 12.50 $48.00",
        "Please deliver to dock 4",
        "WS-C3850-24T Switch 24 port 2 10.00 $20.00",
        "ABC-100 123456 Widget housing 3 $9.00 $27.00",
      ]),
      { vision: null },
    );
    expect(recognized.lines.map((line) => line.sku)).to.deep.equal(["C9300-24P"]);
  });

  it("still reads a loose sku and upc row when the page has no table header", async () => {
    const recognized = await recognizePurchasePdf(
      pdfDocument(["PO Number: PO-100", "ABC-100 123456 Widget housing 3 $9.00 $27.00"]),
      { vision: null },
    );
    expect(recognized.lines).to.have.length(1);
    expect(recognized.lines[0]).to.deep.include({
      sku: "ABC-100",
      upc: "123456",
      description: "Widget housing",
      quantity: 3,
      unitPrice: "$9.00",
      extendedPrice: "$27.00",
    });
  });

  it("uses the MPN column as the SKU when the table also has a SKU column", async () => {
    const recognized = await recognizePurchasePdf(
      pdfDocument([
        "PO Number: PO-100",
        "SKU MPN Description Qty",
        "IGNORE-SKU C9300-24P Catalyst 24 port 4",
      ]),
      { vision: null },
    );
    expect(recognized.lines).to.have.length(1);
    expect(recognized.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
      unitPrice: null,
      extendedPrice: null,
    });
    expect(recognized.lines[0].sku).to.not.equal("IGNORE-SKU");
  });

  it("uses the SKU column when the table has no MPN column", async () => {
    const recognized = await recognizePurchasePdf(
      pdfDocument([
        "PO Number: PO-100",
        "SKU Description Qty",
        "C9300-24P Catalyst 24 port 4",
      ]),
      { vision: null },
    );
    expect(recognized.lines[0]).to.deep.include({
      sku: "C9300-24P",
      description: "Catalyst 24 port",
      quantity: 4,
    });
  });

  it("keeps the existing lines when a later PDF has no item rows", async () => {
    const orders: PurchaseOrder[] = [];
    const first = await recognizePurchasePdf(pdfDocument(SAMPLE_LINES), { vision: null });
    applyRecognizedPurchase(orders, first, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    const again = await recognizePurchasePdf(
      pdfDocument(["PO Number: PO-100", "Vendor: CommScope", "Job Number: JOB-NEW"]),
      { vision: null },
    );
    expect(again.lines).to.deep.equal([]);
    applyRecognizedPurchase(orders, again, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => "99999999-9999-4999-8999-999999999999",
    });
    expect(orders).to.have.length(1);
    expect(orders[0].vendor).to.equal("CommScope");
    expect(orders[0].jobIdNumber).to.equal("JOB-42");
    expect(orders[0].lines).to.have.length(1);
    expect(orders[0].lines?.[0].id).to.equal(LINE_ID);
    expect(orders[0].lines?.[0].sku).to.equal("FBR-LC-12-100");
    expect(orders[0].expectationNotes).to.not.include("JOB-NEW");
  });

  it("stores no placeholder line when the PDF has a ship-to block and no items", async () => {
    const recognized = await recognizePurchasePdf(
      pdfDocument([
        "Vendor: Corning",
        "PO Number: PO-100",
        "Job Number: JOB-42",
        "Ship To:",
        "Saltbox ATL",
      ]),
      { vision: null },
    );
    expect(recognized.lines).to.deep.equal([]);
    const orders: PurchaseOrder[] = [];
    const created = applyRecognizedPurchase(orders, recognized, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    expect(created.lines).to.deep.equal([]);
    expect(created.jobIdNumber).to.equal("JOB-42");
    expect(created.expectationNotes).to.equal("Saltbox ATL");
    expect(created.expectationNotes).to.not.include("JOB-42");
  });

  it("masks numeric prices inside readable text and leaves other PDF bytes unchanged", () => {
    const readable = pdfDocument([
      "MPN Description Qty Rate Amount",
      "C9300-24P Catalyst 24 port 4 12.50 $48.00",
    ]);
    const binary = `(${"\u0001\u0002\u0003"}12.50${"\u0004\u0005\u0006"})`;
    const raw = Buffer.from(readable).toString("latin1").replace("%%EOF", `${binary}\n%%EOF`);
    const bytes = new Uint8Array(Buffer.from(raw, "latin1"));
    const stored = blackOutPricingColumns(bytes, ["12.50", "$48.00", "Rate", "Amount"]);
    const storedRaw = Buffer.from(stored).toString("latin1");
    expect(stored.byteLength).to.equal(bytes.byteLength);
    expect(storedRaw).to.include(binary);
    const storedText = extractPdfText(stored);
    expect(storedText).to.match(/\bRate\b/);
    expect(storedText).to.match(/\bAmount\b/);
    expect(storedText).to.include("C9300-24P");
    expect(storedText).to.include("Catalyst 24 port");
    expect(storedText).to.not.include("12.50");
    expect(storedText).to.not.include("$48.00");
    expect(storedText).to.match(/\b4\b/);
  });

  it("collects only numeric rate and amount cell values for blackout", () => {
    expect(
      pricingBlackoutTokens([
        { unitPrice: "Rate", extendedPrice: "4" },
        { unitPrice: " 12.50 ", extendedPrice: "$1,250.00" },
        { unitPrice: "", extendedPrice: null },
        { unitPrice: "12.5", extendedPrice: "$48" },
      ]),
    ).to.deep.equal(["12.50", "$1,250.00"]);
  });

  it("returns the same PDF bytes when the token list has no numeric prices", () => {
    const bytes = pdfDocument(["Rate Amount 4 C9300-24P $not-a-price"]);
    const stored = blackOutPricingColumns(bytes, ["Rate", "Amount", "4", ""]);
    expect(stored).to.equal(bytes);
    expect(extractPdfText(stored)).to.include("Rate Amount 4 C9300-24P");
  });

  it("masks a comma amount and leaves the quantity digit in place", () => {
    const bytes = pdfDocument([
      "MPN Description Qty Rate Amount",
      "C9300-24P Catalyst 24 port 4 12.50 $1,250.00",
    ]);
    const stored = blackOutPricingColumns(bytes, pricingBlackoutTokens([
      { unitPrice: "12.50", extendedPrice: "$1,250.00" },
    ]));
    const storedText = extractPdfText(stored);
    expect(stored.byteLength).to.equal(bytes.byteLength);
    expect(storedText).to.include("C9300-24P Catalyst 24 port 4 ##### #########");
    expect(storedText).to.match(/\bRate\b/);
    expect(storedText).to.match(/\bAmount\b/);
    expect(storedText).to.not.include("12.50");
    expect(storedText).to.not.include("$1,250.00");
    expect(storedText).to.not.include("1,250");
  });

  it("drops Rate and Amount values when recognized lines are written to the inbound form", () => {
    const lines = buyerLinesFromRecognition(
      [
        {
          sku: "C9300-24P",
          upc: "",
          description: "Catalyst 24 port 12.50 $48.00",
          quantity: 4,
          unitPrice: "12.50",
          extendedPrice: "$48.00",
        },
      ],
      () => LINE_ID,
    );
    expect(lines[0].quantity).to.equal(4);
    expect(lines[0].description).to.equal("Catalyst 24 port");
    expect(JSON.stringify(lines)).to.not.include("12.50");
    expect(JSON.stringify(lines)).to.not.include("$48.00");
    expect(JSON.stringify(lines)).to.not.include("unitPrice");
  });

  it("fills the inbound PO and keeps a project manager job ID", async () => {
    const recognized = await recognizePurchasePdf(pdfDocument(SAMPLE_LINES), {
      vision: null,
    });
    const orders: PurchaseOrder[] = [];
    const created = applyRecognizedPurchase(orders, recognized, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    expect(created.purchaseOrderNumber).to.equal("PO-100");
    expect(created.jobIdNumber).to.equal("JOB-42");
    expect(created.expectationStatus).to.equal("expected");
    expect(created.source).to.equal("coordinator");
    expect(JSON.stringify(created.lines)).to.not.include("$");
    expect(created.lines?.[0].sku).to.equal("FBR-LC-12-100");

    const again = await recognizePurchasePdf(
      pdfDocument(["PO Number: PO-100", "Job ID: JOB-NEW", "Vendor: CommScope", "Carrier: XPO"]),
      { vision: null },
    );
    applyRecognizedPurchase(orders, again, {
      id: PO_ID,
      now: NOW,
      uploadedBy: "Morgan Coordinator",
      nextLineId: () => LINE_ID,
    });
    expect(orders).to.have.length(1);
    expect(orders[0].jobIdNumber).to.equal("JOB-42");
    expect(orders[0].vendor).to.equal("CommScope");
  });

  it("redacts invoice prices in the PDF and in the line fields", () => {
    const bytes = pdfDocument(SAMPLE_LINES);
    expect(pdfStillContainsPrices(bytes)).to.equal(true);
    const redacted = redactPdfBytes(bytes);
    expect(redacted.byteLength).to.equal(bytes.byteLength);
    expect(Buffer.from(redacted).toString("latin1")).to.not.include("$4.50");
    expect(Buffer.from(redacted).toString("latin1")).to.not.include("$54.00");
    expect(pdfStillContainsPrices(redacted)).to.equal(false);

    const lines = redactDocumentLines([
      {
        sku: "FBR-LC-12-100",
        upc: "010000000001",
        description: "LC fiber $4.50",
        quantity: 12,
        unitPrice: "$4.50",
        extendedPrice: "$54.00",
      },
    ]);
    expect(lines[0].unitPrice).to.equal(null);
    expect(lines[0].extendedPrice).to.equal(null);
    expect(lines[0].description).to.not.include("$");
  });

  it("imports redacted invoice lines into an expected inbound load without prices", () => {
    expect(invoiceImportError({ kind: "invoice", pricesRedacted: false })).to.equal(
      "Redact invoice prices before importing this inbound load.",
    );
    expect(invoiceImportError({ kind: "purchase-order", pricesRedacted: true })).to.include(
      "invoice",
    );
    expect(invoiceImportError({ kind: "invoice", pricesRedacted: true })).to.equal(null);

    const load = buildExpectedInboundLoad({
      id: LOAD_ID,
      palletId: PALLET_ID,
      caseIds: [CASE_ID],
      now: NOW,
      purchaseOrderNumber: "PO-100",
      vendor: "Corning",
      carrier: "Estes",
      palletCount: 2,
      receiverName: "Morgan Coordinator",
      lines: [
        {
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          description: "LC 12ct fiber",
          quantity: 12,
        },
      ],
      existingOrderNumbers: [],
    });
    expect(load.status).to.equal("draft");
    expect(load.intake).to.equal("expected");
    expect(load.orderNumber).to.equal("EXP-PO-100");
    expect(load.pallets[0].palletNumber).to.equal("EXPECTED");
    expect(load.pallets[0].cases[0].sku).to.equal("FBR-LC-12-100");
    expect(JSON.stringify(load)).to.not.include("unitPrice");
    expect(JSON.stringify(load)).to.not.include("$");

    const orders: PurchaseOrder[] = [];
    saveBuyerPurchaseOrder(orders, {
      id: PO_ID,
      purchaseOrderNumber: "PO-100",
      generatedAt: NOW,
      projectId: null,
      vendor: "Corning",
      carrier: "Estes",
      expectedArrivalAt: NOW,
      expectationStatus: "expected",
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
    });
    const forecast = buildInboundForecast(orders, [load]);
    expect(forecast.rows[0].derivedStatus).to.equal("expected");
    expect(forecast.rows[0].receivedUnits).to.equal(0);
    expect(forecast.rows[0].lines[0].receivedQuantity).to.equal(0);
  });

  it("shows invoice prices only before redaction and only to people who may see them", () => {
    const parsed = PurchaseDocumentSchema.parse({
      id: DOC_ID,
      purchaseOrderNumber: "PO-100",
      kind: "invoice",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 1200,
      pricesRedacted: false,
      recognitionSource: "composio",
      recognitionNote: COMPOSIO_NOTE,
      lines: [
        {
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          description: "LC 12ct fiber",
          quantity: 12,
          unitPrice: "$4.50",
          extendedPrice: "$54.00",
        },
      ],
      createdAt: NOW,
    });
    const coordinator = purchaseDocumentView(parsed, {
      canOpenFile: false,
      canUpload: true,
      canSeePrices: true,
    });
    expect(coordinator.canOpenFile).to.equal(false);
    expect(coordinator.canRedact).to.equal(true);
    expect(coordinator.canDelete).to.equal(true);
    expect(coordinator.purchaseOrderNumber).to.equal("PO-100");
    expect(coordinator.lines[0].unitPrice).to.equal("$4.50");

    const associate = purchaseDocumentView(parsed, {
      canOpenFile: false,
      canUpload: false,
      canSeePrices: false,
    });
    expect(associate.lines[0].unitPrice).to.equal(null);
    expect(associate.lines[0].extendedPrice).to.equal(null);
    expect(associate.canRedact).to.equal(false);
    expect(associate.canDelete).to.equal(false);

    const manager = purchaseDocumentView(
      { ...parsed, pricesRedacted: true },
      { canOpenFile: true, canUpload: false, canSeePrices: true },
    );
    expect(manager.canOpenFile).to.equal(true);
    expect(manager.lines[0].unitPrice).to.equal(null);
    expect(manager.canImport).to.equal(false);
    expect(manager.canDelete).to.equal(false);

    const uploadedOrder = purchaseDocumentView(
      { ...parsed, kind: "purchase-order", pricesRedacted: true },
      { canOpenFile: false, canUpload: true, canSeePrices: false },
    );
    expect(uploadedOrder.canDelete).to.equal(true);
    expect(uploadedOrder.canRedact).to.equal(false);
    expect(uploadedOrder.lines[0].unitPrice).to.equal(null);
  });

  it("opens the inbound PDF only for coordinators, project managers, managers, and security managers", () => {
    for (const role of ["coordinator", "project-manager", "manager", "security-manager"] as const) {
      expect(canAccessPath(role, `/api/purchase-documents/${DOC_ID}`, "GET"), role).to.equal(
        true,
      );
    }
    for (const role of ["associate", "security-associate", "threepl", "driver", "user"] as const) {
      expect(canAccessPath(role, `/api/purchase-documents/${DOC_ID}`, "GET"), role).to.equal(
        false,
      );
    }
    expect(canAccessPath("coordinator", "/api/purchase-documents", "POST")).to.equal(true);
    expect(canAccessPath("project-manager", "/api/purchase-documents", "POST")).to.equal(false);
  });

  it("asks Composio for document text detection and reads the vision payload", async () => {
    const bytes = pdfDocument(["PO Number: PO-100"]);
    const args = composioVisionArguments(bytes, "po.pdf", {
      apiKey: "test-key",
      parent: "projects/saltbox/locations/us",
    });
    expect(JSON.stringify(args)).to.include("DOCUMENT_TEXT_DETECTION");
    expect(JSON.stringify(args)).to.include("application/pdf");
    expect(JSON.stringify(args)).to.include(Buffer.from(bytes).toString("base64"));

    const calls: string[] = [];
    const text = await executeComposioVision(
      bytes,
      "po.pdf",
      { apiKey: "test-key", toolSlug: "GOOGLE_CLOUD_VISION_ANNOTATE_FILES" },
      async (url, init) => {
        calls.push(String(url));
        expect(init?.method).to.equal("POST");
        const headers = init?.headers as Record<string, string>;
        expect(headers["x-api-key"]).to.equal("test-key");
        return new Response(
          JSON.stringify({
            successful: true,
            data: {
              responses: [
                {
                  fullTextAnnotation: { text: "PO Number: PO-9\nJob ID: JOB-9" },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    expect(calls[0]).to.include(
      "/api/v3.1/tools/execute/GOOGLE_CLOUD_VISION_ANNOTATE_FILES",
    );
    expect(text.text).to.include("PO Number: PO-9");
    expect(text.failure).to.equal(null);
    expect(
      textFromVisionPayload({
        data: JSON.stringify({
          fullTextAnnotation: { text: "Vendor: Leviton" },
        }),
      }),
    ).to.equal("Vendor: Leviton");
    expect(
      await executeComposioVision(bytes, "po.pdf", {}, async () => {
        throw new Error("should not call");
      }),
    ).to.deep.include({
      text: null,
      failure: { kind: "missing-api-key", status: null, message: "COMPOSIO_API_KEY is missing." },
    });
  });
});

describe("Graybar purchase order layout", () => {
  const bytes = () =>
    new Uint8Array(
      readFileSync(path.join(process.cwd(), "test/fixtures/graybar-po-46867.pdf")),
    );
  const prices = [
    "15.45",
    "370.80",
    "73.42",
    "2,202.60",
    "53.45",
    "213.80",
    "110.00",
    "2,200.00",
    "29.09",
    "407.26",
    "1.34",
    "21.44",
    "290.00",
    "1,160.00",
    "157.26",
    "314.52",
    "$6,890.42",
  ];

  it("reads the circled PO, vendor, job number, and item rows", async () => {
    const recognized = await recognizePurchasePdf(bytes(), { vision: null });
    expect(recognized.purchaseOrderNumber).to.equal("46867");
    expect(recognized.vendor).to.equal("Graybar");
    expect(recognized.jobIdNumber).to.equal("AMA3-11-0383");
    expect(recognized.carrier).to.equal(null);
    expect(recognized.expectedArrivalAt).to.equal(null);
    expect(recognized.shipTo).to.include("MidPoint Technology Group");
    expect(recognized.shipTo).to.include("1314 Chattahoochee Ave NW");
    expect(recognized.lines.map((line) => line.sku)).to.deep.equal([
      "31090",
      "AF1ACL104",
      "AF1ACL101",
      "S200X225VATY",
      "RMEH4BL",
      "1700C",
      "SM SRC-9-SCLC-KIT",
      "WP400P/4500FT",
    ]);
    expect(recognized.lines[0]).to.deep.include({
      description: "AWS FBN No:ATL068ROMP01 Velcro - Velcro Roll",
      quantity: 24,
      unitPrice: "15.45",
      extendedPrice: "370.80",
    });
    expect(recognized.lines[2]).to.deep.include({
      sku: "AF1ACL101",
      description: "AFL - One-Click Cleaner MPO/MTP 500 cleans",
      quantity: 4,
    });
    expect(recognized.lines[6]?.description).to.equal(
      "Fluke - Test Reference Cord, OS2, LC-SC Simplex, 2m",
    );
    expect(JSON.stringify(recognized.lines.map((line) => line.sku))).to.not.include("AF1ACL...");
    expect(recognized.lines.map((line) => line.quantity)).to.deep.equal([
      24, 30, 4, 20, 14, 16, 4, 2,
    ]);
  });

  it("puts the circled fields on the review form and leaves prices off it", async () => {
    const recognized = await recognizePurchasePdf(bytes(), { vision: null });
    const review = inboundReviewFromRecognition(recognized);
    expect(review.purchaseOrderNumber).to.equal("46867");
    expect(review.vendor).to.equal("Graybar");
    expect(review.jobIdNumber).to.equal("AMA3-11-0383");
    expect(review.lines).to.have.length(8);
    expect(review.lines[6]?.sku).to.equal("SM-SRC-9-SCLC-KIT");
    const visible = JSON.stringify(review);
    for (const price of prices) expect(visible).to.not.include(price);
    expect(visible).to.include("AF1ACL104");
    expect(visible).to.include("Velcro - Velcro Roll");
  });

  it("blacks out only the Rate and Amount numbers", async () => {
    const redacted = await redactPositionedPrices(bytes());
    expect(redacted).to.not.equal(null);
    if (!redacted) return;
    const text = (await readPdfGlyphs(redacted)).map((glyph) => glyph.text).join("\n");
    for (const price of prices) expect(text, price).to.not.include(price);
    expect(text).to.include("Graybar");
    expect(text).to.include("46867");
    expect(text).to.include("AMA3-11-0383");
    expect(text).to.include("AF1ACL104");
    expect(text).to.include("WP400P/4500FT");
    expect(text).to.match(/\bRate\b/);
    expect(text).to.match(/\bAmount\b/);
    expect(text).to.match(/\bQty\b/);
    expect(text).to.include("24");
    expect(text).to.include("Velcro - Velcro Roll");
    expect(text).to.include("443-487-4067");
  });
});

describe("inventory history saved with a purchase document", () => {
  it("keeps stock rows whose type and reference are outside the current lists", () => {
    const id = "77777777-7777-4777-8777-777777777777";
    const parsed = InventorySystemSchema.parse({
      transactions: [
        {
          id,
          type: "check-in",
          occurredAt: NOW,
          sku: "FBR-LC-12-100",
          quantityDelta: 1,
          referenceType: "purchase-order",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          type: null,
          occurredAt: NOW,
          sku: "FBR-LC-12-100",
          quantityDelta: -1,
          referenceType: null,
        },
      ],
    });
    expect(parsed.transactions[0]?.type).to.equal("check-in");
    expect(parsed.transactions[0]?.referenceType).to.equal("purchase-order");
    expect(parsed.transactions[1]?.type).to.equal("import");
    expect(parsed.transactions[1]?.referenceType).to.equal(undefined);
    expect(parsed.transactions.map((entry) => entry.id)).to.deep.equal([
      id,
      "88888888-8888-4888-8888-888888888888",
    ]);
  });
});

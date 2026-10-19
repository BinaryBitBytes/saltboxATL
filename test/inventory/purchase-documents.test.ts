import { describe, it } from "mocha";
import { expect } from "chai";
import { PurchaseDocumentSchema, type PurchaseOrder } from "@/lib/inventory-schema";
import { canAccessPath } from "@/lib/auth/permissions";
import { buildInboundForecast } from "@/lib/inbound/forecast";
import { saveBuyerPurchaseOrder } from "@/lib/purchase-orders";
import { isPdf, redactPdfBytes } from "@/lib/documents/pdf-text";
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
import { applyRecognizedPurchase } from "@/lib/documents/apply";
import {
  buildExpectedInboundLoad,
  invoiceImportError,
  pdfStillContainsPrices,
  redactDocumentLines,
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
    expect(coordinator.lines[0].unitPrice).to.equal("$4.50");

    const associate = purchaseDocumentView(parsed, {
      canOpenFile: false,
      canUpload: false,
      canSeePrices: false,
    });
    expect(associate.lines[0].unitPrice).to.equal(null);
    expect(associate.lines[0].extendedPrice).to.equal(null);
    expect(associate.canRedact).to.equal(false);

    const manager = purchaseDocumentView(
      { ...parsed, pricesRedacted: true },
      { canOpenFile: true, canUpload: false, canSeePrices: true },
    );
    expect(manager.canOpenFile).to.equal(true);
    expect(manager.lines[0].unitPrice).to.equal(null);
    expect(manager.canImport).to.equal(false);
  });

  it("keeps the PDF file itself to project managers", () => {
    expect(canAccessPath("coordinator", "/api/purchase-documents", "POST")).to.equal(true);
    expect(canAccessPath("coordinator", `/api/purchase-documents/${DOC_ID}`, "GET")).to.equal(
      false,
    );
    expect(canAccessPath("associate", `/api/purchase-documents/${DOC_ID}`, "GET")).to.equal(
      false,
    );
    expect(canAccessPath("project-manager", `/api/purchase-documents/${DOC_ID}`, "GET")).to.equal(
      true,
    );
    expect(canAccessPath("project-manager", "/api/purchase-documents", "POST")).to.equal(false);
    expect(canAccessPath("manager", `/api/purchase-documents/${DOC_ID}`, "GET")).to.equal(true);
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

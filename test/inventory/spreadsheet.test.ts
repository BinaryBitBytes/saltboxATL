import { describe, it } from "mocha";
import { expect } from "chai";
import { parseCsv, serializeCsv, detectDelimiter, stripBom } from "@/lib/spreadsheet/csv";
import {
  inventoryRowsToSpreadsheet,
  parseInventorySpreadsheet,
  planInventoryImport,
  formatImportErrors,
  assertImportPlanReady,
} from "@/lib/inventory/spreadsheet";
import {
  assertSpreadsheetSize,
  replaySpreadsheetText,
  spreadsheetTextFromForm,
} from "@/lib/inventory/spreadsheet-source";
import { setOnHandQuantity } from "@/backend/server/inventory-ops";
import { nowIso } from "@/backend/server/helperUtils";
import { makeItem, makeLocation } from "../helpers";
import type { InventoryRow, Room } from "@/lib/inventory-schema";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

const room: Room = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Fiber Room",
};

describe("inventory spreadsheet import and export", () => {
  const location = makeLocation({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "A-01-01",
    roomId: room.id,
  });
  const other = makeLocation({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    code: "A-01-02",
    roomId: room.id,
  });

  it("round-trips quoted CSV cells and strips a UTF-8 BOM", () => {
    const csv = serializeCsv(
      ["SKU", "Description"],
      [["FBR-1", '12-strand, "LC" fiber']],
      { bom: true },
    );
    expect(csv.startsWith("\uFEFF")).to.equal(true);
    expect(stripBom(csv)).to.match(/^SKU,Description/);
    const parsed = parseCsv(csv);
    expect(parsed.headers).to.deep.equal(["SKU", "Description"]);
    expect(parsed.rows[0]).to.deep.equal(["FBR-1", '12-strand, "LC" fiber']);
    expect(detectDelimiter("SKU\tQty\tLocation")).to.equal("\t");
  });

  it("exports on-hand inventory and parses that spreadsheet back", () => {
    const rows: InventoryRow[] = [
      {
        ...makeItem({
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          batch: "B1",
          locationId: location.id,
          quantity: 24,
          description: "12-strand LC fiber, 100m",
        }),
        locationCode: location.code,
        roomName: room.name,
      },
    ];
    const csv = inventoryRowsToSpreadsheet(rows);
    const parsed = parseInventorySpreadsheet(csv);
    expect(parsed).to.have.length(1);
    expect(parsed[0]?.sku).to.equal("FBR-LC-12-100");
    expect(parsed[0]?.upc).to.equal("010000000001");
    expect(parsed[0]?.quantityText).to.equal("24");
    expect(parsed[0]?.locationCode).to.equal("A-01-01");
    expect(parsed[0]?.batch).to.equal("B1");
  });

  it("sets on-hand quantity for a new location line and updates an existing one", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      locationId: location.id,
      quantity: 10,
      description: "fiber",
    });
    const csv = [
      "SKU,UPC,Description,Batch,Qty,Location",
      "FBR-LC-12-100,010000000001,fiber,,18,A-01-01",
      "CAT6-BLU-1000,010000000002,Cat6 blue,,6,A-01-02",
    ].join("\n");
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [existing],
      locations: [location, other],
      rooms: [room],
      products: [
        {
          sku: existing.sku,
          upc: existing.upc ?? "",
          description: existing.description ?? existing.sku,
        },
      ],
      mode: "set",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.updated).to.equal(1);
    expect(plan.created).to.equal(1);
    expect(plan.unitsDelta).to.equal(14);
    expect(plan.changes.find((change) => change.action === "update")?.quantityAfter).to.equal(
      18,
    );
  });

  it("adds to existing quantities without replacing them", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      locationId: location.id,
      quantity: 10,
    });
    const csv = "SKU,Qty,Location\nFBR-LC-12-100,5,A-01-01\n";
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "add",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.updated).to.equal(1);
    expect(plan.changes[0]?.quantityAfter).to.equal(15);
  });

  it("rejects unknown locations, inactive bins, duplicate lines, and SKU/UPC conflicts", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      locationId: location.id,
      quantity: 4,
    });
    const inactive = makeLocation({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      code: "Z-99-99",
      roomId: room.id,
      isActive: false,
    });
    const csv = [
      "SKU,UPC,Qty,Location",
      "FBR-LC-12-100,010000000001,4,MISSING",
      "FBR-LC-12-100,010000000001,1,Z-99-99",
      "FBR-LC-12-100,010000000001,2,A-01-01",
      "FBR-LC-12-100,010000000001,3,A-01-01",
      "OTHER-SKU,010000000001,1,A-01-01",
    ].join("\n");
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [existing],
      locations: [location, inactive],
      rooms: [room],
      products: [
        { sku: existing.sku, upc: existing.upc ?? "", description: "fiber" },
      ],
      mode: "set",
    });
    expect(plan.errors.map((error) => error.message).join(" ")).to.match(
      /not found|inactive|Duplicate|already assigned/i,
    );
    expect(plan.errors.length).to.be.at.least(4);
    expect(formatImportErrors(plan.errors)).to.match(/Fix \d+ spreadsheet errors/);
  });

  it("requires SKU, Qty, and Location headers", () => {
    expect(() => parseInventorySpreadsheet("Name,Count\nWidget,3\n")).to.throw(
      /SKU, Qty, and Location/,
    );
  });

  it("sets an existing line to zero and skips creating empty new lines", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      locationId: location.id,
      quantity: 8,
    });
    const csv = [
      "SKU,Qty,Location",
      "FBR-LC-12-100,0,A-01-01",
      "NEW-SKU,0,A-01-01",
    ].join("\n");
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.updated).to.equal(1);
    expect(plan.created).to.equal(0);
    expect(plan.unchanged).to.equal(1);
    expect(plan.changes[0]?.quantityAfter).to.equal(0);
  });

  it("requires confirmation when the net unit change is large", () => {
    const csv = `SKU,Qty,Location\nFBR-LC-12-100,${LIMITS.largeQuantity},A-01-01\n`;
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(plan.requiresConfirmation).to.equal(true);
    expect(plan.unitsDelta).to.equal(LIMITS.largeQuantity);
  });

  it("blocks apply when the plan has errors or only unchanged lines", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      locationId: location.id,
      quantity: 8,
    });
    const unchanged = planInventoryImport({
      rows: parseInventorySpreadsheet("SKU,Qty,Location\nFBR-LC-12-100,8,A-01-01\n"),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(() => assertImportPlanReady(unchanged)).to.throw(
      ValidationError,
      /Nothing to import/,
    );

    const invalid = planInventoryImport({
      rows: parseInventorySpreadsheet("SKU,Qty,Location\nFBR-LC-12-100,8,MISSING\n"),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(() => assertImportPlanReady(invalid)).to.throw(
      ValidationError,
      /not found/i,
    );

    const ready = planInventoryImport({
      rows: parseInventorySpreadsheet("SKU,Qty,Location\nFBR-LC-12-100,9,A-01-01\n"),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(() => assertImportPlanReady(ready)).not.to.throw();
  });

  it("rejects oversized pasted or uploaded spreadsheets before parsing", async () => {
    expect(() => assertSpreadsheetSize(LIMITS.spreadsheetMaxBytes)).not.to.throw();
    expect(() => assertSpreadsheetSize(LIMITS.spreadsheetMaxBytes + 1)).to.throw(
      ValidationError,
      /MB or smaller/,
    );

    const oversized = new FormData();
    oversized.set("text", "x".repeat(LIMITS.spreadsheetMaxBytes + 1));
    try {
      await spreadsheetTextFromForm(oversized);
      expect.fail("pasted spreadsheet should have been rejected");
    } catch (error) {
      expect(error).to.be.instanceOf(ValidationError);
      expect((error as Error).message).to.match(/MB or smaller/);
    }

    const workbook = new FormData();
    workbook.set("file", new File(["not a csv"], "stock.xlsx"));
    try {
      await spreadsheetTextFromForm(workbook);
      expect.fail("xlsx upload should have been rejected");
    } catch (error) {
      expect(error).to.be.instanceOf(ValidationError);
      expect((error as Error).message).to.match(/CSV UTF-8/);
    }

    const csv = new File(["SKU,Qty,Location\nFBR-LC-12-100,1,A-01-01\n"], "stock.csv");
    const uploaded = new FormData();
    uploaded.set("file", csv);
    const fromFile = await spreadsheetTextFromForm(uploaded);
    expect(fromFile.source).to.equal("file");
    expect(replaySpreadsheetText(fromFile, true)).to.equal("");
    expect(replaySpreadsheetText(fromFile, false)).to.equal(fromFile.text);

    const pasted = new FormData();
    pasted.set("text", "SKU,Qty,Location\nFBR-LC-12-100,1,A-01-01\n");
    const fromPaste = await spreadsheetTextFromForm(pasted);
    expect(fromPaste.source).to.equal("paste");
    expect(replaySpreadsheetText(fromPaste, true)).to.equal(fromPaste.text);

    const stalePaste = new FormData();
    stalePaste.set("text", "SKU,Qty,Location\nOLD,1,A-01-01\n");
    stalePaste.set("file", new File(["SKU,Qty,Location\nNEW,2,A-01-01\n"], "fixed.csv"));
    const preferred = await spreadsheetTextFromForm(stalePaste);
    expect(preferred.source).to.equal("file");
    expect(preferred.text).to.match(/NEW,2/);
  });

  it("writes on-hand quantity through setOnHandQuantity", () => {
    const item = makeItem({ quantity: 4, locationId: location.id });
    const lowered = setOnHandQuantity([item], {
      sku: item.sku,
      upc: item.upc,
      batch: item.batch,
      locationId: item.locationId,
      quantity: 1,
      now: nowIso(),
    });
    expect(lowered.change?.quantityAfter).to.equal(1);
    expect(lowered.change?.quantityDelta).to.equal(-3);
  });
});

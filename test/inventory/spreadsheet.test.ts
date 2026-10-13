import { describe, it } from "mocha";
import { expect } from "chai";
import { parseCsv, serializeCsv, detectDelimiter, stripBom } from "@/lib/spreadsheet/csv";
import {
  INVENTORY_SPREADSHEET_HEADERS,
  inventoryRowsToSpreadsheet,
  inventorySpreadsheetTemplate,
  parseInventorySpreadsheet,
  planInventoryImport,
  formatImportErrors,
  assertImportPlanReady,
} from "@/lib/inventory/spreadsheet";
import { putAwayCases, setOnHandQuantity } from "@/backend/server/inventory-ops";
import { enrichInventory } from "@/backend/server/inventory-service";
import {
  applyInventoryDetails,
  attributesFromReceiving,
  backfillOnHandAttributes,
} from "@/lib/inventory/details";
import type { CaseItem, InventoryRow, ReceivingOrder, Room } from "@/lib/inventory-schema";
import {
  assertSpreadsheetSize,
  replaySpreadsheetText,
  spreadsheetTextFromForm,
} from "@/lib/inventory/spreadsheet-source";
import { nowIso } from "@/backend/server/helperUtils";
import { makeItem, makeLocation } from "../helpers";
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

  it("puts every inventory field in the export and the blank template", () => {
    const template = parseCsv(inventorySpreadsheetTemplate());
    expect(template.headers).to.deep.equal([...INVENTORY_SPREADSHEET_HEADERS]);
    expect(template.rows).to.deep.equal([]);

    const rows: InventoryRow[] = [
      {
        ...makeItem({
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          batch: "B1",
          locationId: location.id,
          quantity: 24,
          description: "12-strand LC fiber, 100m",
          manufacturer: "Corning",
          color: "Blue",
          fiber: {
            isFiber: true,
            connectionType: "LC",
            strandCount: 12,
            lengthMeters: 100,
          },
          lastMovedAt: "2026-10-05T12:00:00.000Z",
        }),
        locationCode: location.code,
        roomName: room.name,
      },
    ];
    const csv = inventoryRowsToSpreadsheet(rows);
    expect(parseCsv(csv).headers).to.deep.equal([...INVENTORY_SPREADSHEET_HEADERS]);
    const parsed = parseInventorySpreadsheet(csv);
    expect(parsed[0]).to.include({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      description: "12-strand LC fiber, 100m",
      manufacturer: "Corning",
      color: "Blue",
      batch: "B1",
      quantityText: "24",
      locationCode: "A-01-01",
      roomName: room.name,
      fiber: "Yes",
      connection: "LC",
      strandCount: "12",
      lengthMeters: "100",
    });

    const plan = planInventoryImport({
      rows: parsed,
      items: rows,
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.unchanged).to.equal(1);
    expect(plan.updated).to.equal(0);
    expect(plan.created).to.equal(0);
  });

  it("imports manufacturer, color, and fiber without dropping them on a later export", () => {
    const csv = [
      "SKU,UPC,Description,Manufacturer,Color,Batch,Qty,Location,Room,Fiber,Connection,Strand count,Length (m)",
      "FBR-LC-12-100,010000000001,12-strand LC fiber,Corning,Blue,B1,24,A-01-01,Fiber Room,Yes,LC,12,100",
    ].join("\n");
    const plan = planInventoryImport({
      rows: parseInventorySpreadsheet(csv),
      items: [],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(plan.errors).to.deep.equal([]);
    expect(plan.created).to.equal(1);
    const change = plan.changes[0];
    expect(change?.manufacturer).to.equal("Corning");
    expect(change?.color).to.equal("Blue");
    expect(change?.fiber).to.deep.equal({
      isFiber: true,
      connectionType: "LC",
      strandCount: 12,
      lengthMeters: 100,
    });

    const applied = setOnHandQuantity([], {
      sku: change!.sku,
      upc: change!.upc,
      batch: change!.batch,
      locationId: change!.locationId,
      quantity: change!.quantityAfter,
      description: change!.description,
      details: {
        manufacturer: change!.manufacturer,
        color: change!.color,
        fiber: change!.fiber,
      },
      now: nowIso(),
    });
    const stored = applied.items[0];
    expect(stored?.manufacturer).to.equal("Corning");
    expect(stored?.fiber?.connectionType).to.equal("LC");
    const exported = parseInventorySpreadsheet(
      inventoryRowsToSpreadsheet([
        {
          ...stored!,
          locationCode: location.code,
          roomName: room.name,
        },
      ]),
    );
    expect(exported[0]?.manufacturer).to.equal("Corning");
    expect(exported[0]?.color).to.equal("Blue");
    expect(exported[0]?.strandCount).to.equal("12");
    expect(exported[0]?.lengthMeters).to.equal("100");
  });

  it("keeps older spreadsheets working and rejects bad fiber values", () => {
    const existing = makeItem({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      locationId: location.id,
      quantity: 10,
      manufacturer: "Corning",
      color: "Blue",
    });
    const legacy = planInventoryImport({
      rows: parseInventorySpreadsheet("SKU,Qty,Location\nFBR-LC-12-100,12,A-01-01\n"),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(legacy.errors).to.deep.equal([]);
    expect(legacy.changes[0]?.manufacturer).to.equal(undefined);
    expect(legacy.changes[0]?.fiber).to.equal(undefined);

    const attributeOnly = planInventoryImport({
      rows: parseInventorySpreadsheet(
        "SKU,Qty,Location,Manufacturer,Color\nFBR-LC-12-100,10,A-01-01,CommScope,Orange\n",
      ),
      items: [existing],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    expect(attributeOnly.errors).to.deep.equal([]);
    expect(attributeOnly.updated).to.equal(1);
    expect(attributeOnly.unitsDelta).to.equal(0);

    const invalid = planInventoryImport({
      rows: parseInventorySpreadsheet(
        [
          "SKU,Qty,Location,Fiber,Connection,Strand count,Length (m)",
          "FBR-LC-12-100,1,A-01-01,Maybe,LC,12,100",
          "FBR-LC-12-100,1,A-01-01,Yes,USB,12,100",
          "CAT6-BLU-1000,1,A-01-01,Yes,LC,13,100",
          "FBR-MPO-24-50,1,A-01-01,No,MPO,24,50",
          "PATCH-1,1,A-01-01,Yes,LC,12,-2",
        ].join("\n"),
      ),
      items: [],
      locations: [location],
      rooms: [room],
      products: [],
      mode: "set",
    });
    const messages = invalid.errors.map((error) => error.message).join(" ");
    expect(messages).to.match(/Fiber must be Yes or No/);
    expect(messages).to.match(/Connection must be one of/);
    expect(messages).to.match(/Strand count must be one of/);
    expect(messages).to.match(/Fiber is No/);
    expect(messages).to.match(/Length \(m\)/);
    expect(invalid.created).to.equal(0);
  });

  it("copies manufacturer, color, and fiber from putaway onto the on-hand export", () => {
    const caseItem: CaseItem = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      batch: "B1",
      quantityInCase: 6,
      description: "12-strand LC fiber, 100m",
      manufacturer: "Corning",
      color: "Blue",
      fiber: {
        isFiber: true,
        connectionType: "LC",
        strandCount: 12,
        lengthMeters: 100,
      },
      putawayRoomId: room.id,
      putawayLocationId: location.id,
      putawayPostedAt: null,
    };
    const posted = putAwayCases([], [caseItem], nowIso());
    expect(posted.items[0]?.manufacturer).to.equal("Corning");
    expect(posted.items[0]?.color).to.equal("Blue");
    expect(posted.items[0]?.fiber?.strandCount).to.equal(12);
    const parsed = parseInventorySpreadsheet(
      inventoryRowsToSpreadsheet([
        {
          ...posted.items[0]!,
          locationCode: location.code,
          roomName: room.name,
        },
      ]),
    );
    expect(parsed[0]?.manufacturer).to.equal("Corning");
    expect(parsed[0]?.connection).to.equal("LC");
  });

  it("exports color, manufacturer, and fiber stored on the received case when the on-hand line is blank", () => {
    const item = makeItem({
      sku: "CBL-ORG-100",
      upc: "010000000088",
      description: "orange cable",
      locationId: location.id,
      quantity: 15,
      manufacturer: "",
      color: null,
      fiber: null,
      batch: null,
    });
    const order = {
      status: "completed",
      pallets: [
        {
          cases: [
            {
              sku: "CBL-ORG-100",
              batch: null,
              manufacturer: "Belden",
              color: "Orange",
              fiber: {
                isFiber: true,
                connectionType: "LC",
                strandCount: 1,
                lengthMeters: 100,
              },
              putawayLocationId: location.id,
              putawayPostedAt: "2026-10-05T12:00:00.000Z",
            },
          ],
        },
      ],
    } as ReceivingOrder;
    const filled = applyInventoryDetails(item, attributesFromReceiving(item, [order]));
    expect(filled.color).to.equal("Orange");
    expect(filled.manufacturer).to.equal("Belden");
    expect(filled.fiber?.connectionType).to.equal("LC");

    const rows = enrichInventory({
      inventoryItems: [item],
      locations: [location],
      rooms: [room],
      receivingOrders: [order],
      shippingOrders: [],
      customerOrders: [],
      siteTransfers: [],
      purchaseOrders: [],
      transactions: [],
      photos: [],
      users: [],
      itemCubes: [],
    });
    const parsed = parseInventorySpreadsheet(inventoryRowsToSpreadsheet(rows));
    expect(parsed[0]?.color).to.equal("Orange");
    expect(parsed[0]?.manufacturer).to.equal("Belden");
    expect(parsed[0]?.fiber).to.equal("Yes");
    expect(parsed[0]?.connection).to.equal("LC");
    expect(parsed[0]?.strandCount).to.equal("1");
    expect(parsed[0]?.lengthMeters).to.equal("100");

    expect(backfillOnHandAttributes({
      inventoryItems: [item],
      receivingOrders: [order],
    })).to.equal(true);
    expect(item.color).to.equal("Orange");

    const painted = makeItem({
      sku: "CBL-ORG-100",
      locationId: location.id,
      color: "Blue",
    });
    expect(attributesFromReceiving(painted, [order]).color).to.equal(undefined);
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

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  assertProductCodePair,
  generateSkuCandidate,
  generateUniqueSku,
  generateUniqueUpc,
  generateUpcCandidate,
  resolveReceivingProductCodes,
  type KnownProduct,
} from "@/lib/codes/product-codes";
import { CaseItemInputSchema } from "@/lib/inventory-schema";
import { ValidationError } from "@/lib/validation/errors";

const catalog: KnownProduct[] = [
  { sku: "FBR-LC-12-100", upc: "010000000001", description: "LC 12ct fiber" },
];

describe("receiving product codes", () => {
  it("requires a description before auto-generating a SKU or UPC", () => {
    expect(() =>
      resolveReceivingProductCodes({
        description: "",
        generateSku: true,
        products: [],
      }),
    ).to.throw(ValidationError, /description/i);

    expect(() =>
      resolveReceivingProductCodes({
        description: "   ",
        generateUpc: true,
        products: [],
      }),
    ).to.throw(ValidationError, /description/i);
  });

  it("requires a vendor SKU or UPC when auto-generate is not requested", () => {
    expect(() =>
      resolveReceivingProductCodes({
        description: "Unlabeled case",
        products: [],
      }),
    ).to.throw(ValidationError, /SKU/i);

    expect(() =>
      resolveReceivingProductCodes({
        description: "Unlabeled case",
        sku: "SBX-UNLABELED",
        products: [],
      }),
    ).to.throw(ValidationError, /UPC/i);
  });

  it("auto-generates unique SKUs and UPCs that are not already in use", () => {
    const first = resolveReceivingProductCodes({
      description: "Blue jumper 3mm",
      generateSku: true,
      generateUpc: true,
      products: catalog,
    });
    expect(first.sku).to.match(/^SBX-/);
    expect(first.upc).to.match(/^\d{12}$/);
    expect(first.sku.toLowerCase()).to.not.equal(catalog[0].sku.toLowerCase());
    expect(first.upc).to.not.equal(catalog[0].upc);

    const second = resolveReceivingProductCodes({
      description: "Red jumper 3mm",
      generateSku: true,
      generateUpc: true,
      products: [...catalog, { ...first, description: "Blue jumper 3mm" }],
    });
    expect(second.sku).to.not.equal(first.sku);
    expect(second.upc).to.not.equal(first.upc);
  });

  it("reuses the existing identity when the description already matches a product", () => {
    const reused = resolveReceivingProductCodes({
      description: "lc 12ct fiber",
      generateSku: true,
      generateUpc: true,
      products: catalog,
    });
    expect(reused.sku).to.equal(catalog[0].sku);
    expect(reused.upc).to.equal(catalog[0].upc);
  });

  it("allows the same SKU and UPC on another case of the same product", () => {
    expect(() =>
      assertProductCodePair(catalog[0].sku, catalog[0].upc, catalog),
    ).to.not.throw();
    expect(
      resolveReceivingProductCodes({
        description: "Another case of LC 12ct fiber",
        sku: catalog[0].sku,
        upc: catalog[0].upc,
        products: catalog,
      }),
    ).to.deep.equal({ sku: catalog[0].sku, upc: catalog[0].upc });
  });

  it("rejects a SKU paired with a different UPC and a UPC paired with a different SKU", () => {
    expect(() =>
      resolveReceivingProductCodes({
        description: "Conflict",
        sku: catalog[0].sku,
        upc: "019999999999",
        products: catalog,
      }),
    ).to.throw(ValidationError, /already assigned/i);

    expect(() =>
      resolveReceivingProductCodes({
        description: "Conflict",
        sku: "OTHER-SKU",
        upc: catalog[0].upc,
        products: catalog,
      }),
    ).to.throw(ValidationError, /already assigned/i);
  });

  it("suffixes auto-generated SKUs when the preferred code is taken", () => {
    expect(generateSkuCandidate("Widget", 0)).to.equal("SBX-WIDGET");
    const unique = generateUniqueSku("Widget", [
      { sku: "SBX-WIDGET", upc: "200000000001", description: "Widget" },
    ]);
    expect(unique).to.not.equal("SBX-WIDGET");
    expect(unique.startsWith("SBX-WIDGET-")).to.equal(true);
  });

  it("keeps auto-generated UPCs unique across attempts", () => {
    const seed = "orphan case";
    const first = generateUpcCandidate(seed, 0);
    const unique = generateUniqueUpc(seed, [
      { sku: "SBX-ORPHAN", upc: first, description: seed },
    ]);
    expect(unique).to.not.equal(first);
    expect(unique).to.match(/^\d{12}$/);
  });

  it("accepts receiving case input with empty vendor codes when generate flags are set", () => {
    const parsed = CaseItemInputSchema.safeParse({
      description: "Vendor unlabeled cable",
      quantityInCase: 12,
      generateSku: true,
      generateUpc: true,
    });
    expect(parsed.success).to.equal(true);
    if (parsed.success) {
      expect(parsed.data.sku).to.equal("");
      expect(parsed.data.upc).to.equal("");
      expect(parsed.data.generateSku).to.equal(true);
      expect(parsed.data.generateUpc).to.equal(true);
    }
  });
});

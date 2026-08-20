import { describe, it } from "mocha";
import { expect } from "chai";
import { matchesScan, parseScanCode } from "@/lib/scan-code";

describe("scan code parsing", () => {
  it("treats numeric codes as UPCs and JSON/QR payloads as SKU+UPC", () => {
    expect(parseScanCode("010000000001")).to.deep.include({ upc: "010000000001" });
    expect(parseScanCode('{"sku":"FBR-LC-12-100","upc":"010000000001"}')).to.include({
      sku: "FBR-LC-12-100",
      upc: "010000000001",
    });
    expect(
      matchesScan(
        { sku: "FBR-LC-12-100", upc: "010000000001", batch: null },
        parseScanCode("010000000001"),
      ),
    ).to.equal(true);
  });
});

import { describe, it } from "mocha";
import { expect } from "chai";
import {
  CreateAdjustmentInputSchema,
  CreateUserInputSchema,
  LoginInputSchema,
} from "@/lib/inventory-schema";
import {
  PersonNameSchema,
  QuantitySchema,
  SafeTextSchema,
  SkuSchema,
  UpcSchema,
} from "@/lib/validation/fields";
import { LIMITS } from "@/lib/validation/limits";

describe("user and inventory input validation", () => {
  it("rejects HTML and control characters in free-text fields", () => {
    expect(SafeTextSchema.safeParse("<script>alert(1)</script>").success).to.equal(false);
    expect(SafeTextSchema.safeParse("ok\u0000value").success).to.equal(false);
    expect(PersonNameSchema.safeParse("Riley User").success).to.equal(true);
    expect(PersonNameSchema.safeParse("Riley <b>User</b>").success).to.equal(false);
  });

  it("enforces password complexity for new accounts but not login length leaks", () => {
    expect(CreateUserInputSchema.safeParse({
      name: "Casey New",
      email: "casey@saltbox.local",
      password: "short",
      role: "user",
    }).success).to.equal(false);
    expect(CreateUserInputSchema.safeParse({
      name: "Casey New",
      email: "casey@saltbox.local",
      password: "lettersonly",
      role: "user",
    }).success).to.equal(false);
    expect(CreateUserInputSchema.safeParse({
      name: "Casey New",
      email: "casey@saltbox.local",
      password: "saltbox123",
      role: "associate",
    }).success).to.equal(true);
    expect(LoginInputSchema.safeParse({
      email: "user@saltbox.local",
      password: "x",
    }).success).to.equal(true);
  });

  it("normalizes emails and caps field lengths", () => {
    const parsed = LoginInputSchema.parse({
      email: "  Manager@Saltbox.Local  ",
      password: "saltbox123",
    });
    expect(parsed.email).to.equal("manager@saltbox.local");
    expect(PersonNameSchema.safeParse("A".repeat(LIMITS.name + 1)).success).to.equal(false);
  });

  it("rejects unsafe SKU, UPC, and out-of-range quantities", () => {
    expect(SkuSchema.safeParse("FBR-LC-12-100").success).to.equal(true);
    expect(SkuSchema.safeParse("../../etc/passwd").success).to.equal(false);
    expect(UpcSchema.safeParse("010000000001").success).to.equal(true);
    expect(UpcSchema.safeParse("drop table").success).to.equal(false);
    expect(QuantitySchema.safeParse(0).success).to.equal(false);
    expect(QuantitySchema.safeParse(1.5).success).to.equal(false);
    expect(QuantitySchema.safeParse(LIMITS.quantityMax + 1).success).to.equal(false);
    expect(CreateAdjustmentInputSchema.safeParse({
      type: "overage",
      quantity: 2,
      reason: "Cycle count",
    }).success).to.equal(true);
  });
});

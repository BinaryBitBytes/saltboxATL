import { describe, it } from "mocha";
import { expect } from "chai";
import {
  assertLargeInputConfirmed,
  isLargeQuantity,
  sumQuantities,
} from "@/lib/validation/large-input";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";
import { largeInputPayload } from "@/lib/validation/large-input";

describe("large data input confirmation", () => {
  it("does not require confirmation below the threshold", () => {
    expect(isLargeQuantity(LIMITS.largeQuantity - 1)).to.equal(false);
    expect(() => assertLargeInputConfirmed(10, undefined)).not.to.throw();
    expect(largeInputPayload(10, false, "")).to.deep.equal({});
  });

  it("requires an explicit confirmation and matching quantity for large inputs", () => {
    expect(isLargeQuantity(LIMITS.largeQuantity)).to.equal(true);
    expect(() =>
      assertLargeInputConfirmed(LIMITS.largeQuantity, undefined),
    ).to.throw(ValidationError, /confirm/i);

    expect(() =>
      assertLargeInputConfirmed(750, {
        confirmLargeInput: true,
        confirmationQuantity: 749,
      }),
    ).to.throw(ValidationError, /exactly match/i);

    expect(() =>
      assertLargeInputConfirmed(750, {
        confirmLargeInput: true,
        confirmationQuantity: 750,
      }),
    ).not.to.throw();
  });

  it("sums shipment picks for a single confirmation total", () => {
    expect(sumQuantities([{ quantity: 120 }, { quantity: 80 }, 10])).to.equal(210);
    const payload = largeInputPayload(210, true, 210, LIMITS.largePickTotal);
    expect(payload).to.deep.equal({
      confirmLargeInput: true,
      confirmationQuantity: 210,
    });
  });
});

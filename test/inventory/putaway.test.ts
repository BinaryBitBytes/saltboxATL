import { describe, it } from "mocha";
import { expect } from "chai";
import {
  isAwaitingPutaway,
  isReceivingEditable,
  PutawayLocationInputSchema,
} from "@/lib/inventory-schema";
import { assertPutawayReady } from "@/lib/validation/inventory-guards";
import { ValidationError } from "@/lib/validation/errors";

describe("receiving and putaway process split", () => {
  it("treats draft and in-progress orders as receiving-editable", () => {
    expect(isReceivingEditable("draft")).to.equal(true);
    expect(isReceivingEditable("in-progress")).to.equal(true);
    expect(isReceivingEditable("received")).to.equal(false);
    expect(isReceivingEditable("completed")).to.equal(false);
    expect(isReceivingEditable("cancelled")).to.equal(false);
  });

  it("queues received orders for putaway instead of treating them as completed stock", () => {
    expect(isAwaitingPutaway("received")).to.equal(true);
    expect(isAwaitingPutaway("draft")).to.equal(false);
    expect(isAwaitingPutaway("in-progress")).to.equal(false);
    expect(isAwaitingPutaway("completed")).to.equal(false);
  });

  it("requires a bin location before putaway can complete", () => {
    expect(() =>
      assertPutawayReady([
        { sku: "FBR-LC-12-100", putawayLocationId: null },
      ]),
    ).to.throw(ValidationError, /putaway location/i);

    expect(() =>
      assertPutawayReady([
        {
          sku: "FBR-LC-12-100",
          putawayLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ]),
    ).to.not.throw();
  });

  it("accepts a putaway location assignment payload", () => {
    const parsed = PutawayLocationInputSchema.safeParse({
      putawayLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      applyToPallet: true,
    });
    expect(parsed.success).to.equal(true);
    if (parsed.success) {
      expect(parsed.data.applyToPallet).to.equal(true);
    }
  });
});

import { describe, it } from "mocha";
import { expect } from "chai";
import { emptyActiveLocations } from "@/lib/locations/availability";
import { resolveTheme } from "@/lib/theme";
import { makeItem, makeLocation } from "../helpers";

describe("theme and empty location availability", () => {
  it("resolves system theme from the preferred color scheme", () => {
    expect(resolveTheme("system", true)).to.equal("dark");
    expect(resolveTheme("system", false)).to.equal("light");
    expect(resolveTheme("light", true)).to.equal("light");
    expect(resolveTheme("dark", false)).to.equal("dark");
  });

  it("lists active locations with no on-hand quantity as empty", () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const empty = makeLocation({ code: "B-02-01", roomId });
    const occupied = makeLocation({ code: "A-01-01", roomId });
    const inactive = makeLocation({
      code: "Z-09-09",
      roomId,
      isActive: false,
    });
    const zeroQty = makeLocation({ code: "C-03-01", roomId });

    const available = emptyActiveLocations(
      [occupied, empty, inactive, zeroQty],
      [{ id: roomId, name: "Main floor" }],
      [
        makeItem({ locationId: occupied.id, quantity: 8 }),
        makeItem({ locationId: zeroQty.id, quantity: 0 }),
      ],
    );

    expect(available.map((location) => location.code)).to.deep.equal([
      "B-02-01",
      "C-03-01",
    ]);
    expect(available[0].roomName).to.equal("Main floor");
  });
});

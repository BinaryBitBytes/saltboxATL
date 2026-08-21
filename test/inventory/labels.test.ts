import { describe, it } from "mocha";
import { expect } from "chai";
import {
  encodeLocationPayload,
  encodeScanPayload,
  matchesScan,
  parseScanCode,
} from "@/lib/scan-code";
import {
  buildInboundLabels,
  buildLocationLabels,
  buildOutboundLabels,
} from "@/lib/labels/build-labels";
import type { ReceivingOrder, ShippingOrder } from "@/lib/inventory-schema";
import { makeLocation } from "../helpers";

const caseItem = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  upc: "010000000001",
  sku: "FBR-LC-12-100",
  batch: "B1",
  quantityInCase: 12,
  description: "LC 12ct fiber",
  fiber: null,
  putawayRoomId: null,
  putawayLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("warehouse label printing", () => {
  it("encodes location QR payloads that parse back to a location code", () => {
    const encoded = encodeLocationPayload({ code: "A-01-01", room: "Main" });
    const parsed = parseScanCode(encoded);
    expect(parsed.locationCode).to.equal("A-01-01");
    expect(
      matchesScan(
        { sku: "FBR-LC-12-100", upc: "010000000001", locationCode: "A-01-01" },
        parsed,
      ),
    ).to.equal(true);
  });

  it("builds one inbound label per received case", () => {
    const order = {
      id: "11111111-1111-4111-8111-111111111111",
      orderNumber: "RCV-1",
      poNumber: "PO-9",
      vendor: "Corning",
      pallets: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          palletNumber: "P1",
          cases: [caseItem],
        },
      ],
    } as ReceivingOrder;
    const labels = buildInboundLabels(order);
    expect(labels).to.have.length(1);
    expect(labels[0].kind).to.equal("inbound");
    expect(labels[0].title).to.equal("FBR-LC-12-100");
    expect(labels[0].barcodeValue).to.equal("010000000001");
    expect(parseScanCode(labels[0].qrValue).sku).to.equal("FBR-LC-12-100");
    expect(labels[0].fields.some((field) => field.value === "P1")).to.equal(true);
  });

  it("builds outbound labels from picked shipment cases", () => {
    const order = {
      shipmentNumber: "OUT-44",
      customer: "Acme Fiber",
      carrierOutbound: "Estes",
      pallets: [
        {
          palletNumber: "OUT-1",
          cases: [caseItem],
        },
      ],
    } as ShippingOrder;
    const labels = buildOutboundLabels(
      order,
      new Map([[caseItem.putawayLocationId!, "A-01-01"]]),
    );
    expect(labels[0].kind).to.equal("outbound");
    expect(labels[0].heading).to.equal("Outbound freight");
    expect(labels[0].fields.some((field) => field.value === "A-01-01")).to.equal(
      true,
    );
    expect(parseScanCode(encodeScanPayload({ sku: caseItem.sku, upc: caseItem.upc })).upc).to.equal(
      caseItem.upc,
    );
  });

  it("builds location labels from selected bins", () => {
    const location = makeLocation({ code: "B-02-02" });
    const labels = buildLocationLabels([
      { ...location, roomName: "Cage" },
    ]);
    expect(labels[0].kind).to.equal("location");
    expect(labels[0].title).to.equal("B-02-02");
    expect(parseScanCode(labels[0].qrValue).locationCode).to.equal("B-02-02");
  });
});

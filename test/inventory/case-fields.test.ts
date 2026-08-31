import { describe, it } from "mocha";
import { expect } from "chai";
import {
  CaseItemInputSchema,
  CaseItemSchema,
  CreateShippingOrderInputSchema,
  PalletInputSchema,
  PalletSchema,
} from "@/lib/inventory-schema";
import { caseItemAttributesFromInbound } from "@/backend/server/inventory-ops";
import { formatCaseItemLine, formatPalletHeading } from "@/lib/format";
import { buildInboundLabels, buildOutboundLabels } from "@/lib/labels/build-labels";
import { buildLoadManifest, buildPackSlip } from "@/lib/shipping/documents";
import type { ReceivingOrder, ShippingOrder } from "@/lib/inventory-schema";
import { createId } from "@/backend/server/helperUtils";

const caseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const palletId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const locationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("case and working pallet schema fields", () => {
  it("defaults manufacturer, color, and tracking number on stored records", () => {
    const item = CaseItemSchema.parse({
      id: caseId,
      upc: "010000000001",
      sku: "FBR-LC-12-100",
      quantityInCase: 12,
      description: "LC 12ct fiber",
    });
    expect(item.manufacturer).to.equal("");
    expect(item.color).to.equal(null);

    const pallet = PalletSchema.parse({
      id: palletId,
      palletNumber: "P1",
    });
    expect(pallet.trackingNumber).to.equal("");
  });

  it("accepts manufacturer, nullable color, and tracking number on inputs", () => {
    const caseInput = CaseItemInputSchema.parse({
      description: "LC 12ct fiber",
      quantityInCase: 12,
      generateSku: true,
      generateUpc: true,
      manufacturer: "Corning",
      color: "",
    });
    expect(caseInput.manufacturer).to.equal("Corning");
    expect(caseInput.color).to.equal(null);

    const palletInput = PalletInputSchema.parse({
      palletNumber: "P1",
      trackingNumber: "1Z999AA10123456784",
    });
    expect(palletInput.trackingNumber).to.equal("1Z999AA10123456784");

    const shipping = CreateShippingOrderInputSchema.parse({
      customer: "Acme Fiber",
      shipmentNumber: "OUT-44",
      carrierOutbound: "Estes",
      shipperName: "Jordan Associate",
      trackingNumber: "1Z999AA10123456784",
      picks: [
        {
          inventoryItemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          quantity: 2,
        },
      ],
    });
    expect(shipping.trackingNumber).to.equal("1Z999AA10123456784");
  });

  it("copies inbound manufacturer and color onto matching outbound picks", () => {
    const attributes = caseItemAttributesFromInbound(
      [
        {
          id: createId(),
          status: "completed",
          pallets: [
            {
              cases: [
                {
                  sku: "FBR-LC-12-100",
                  batch: "B1",
                  manufacturer: "Corning",
                  color: "Yellow",
                },
              ],
            },
          ],
        } as ReceivingOrder,
      ],
      "FBR-LC-12-100",
      "B1",
    );
    expect(attributes).to.deep.equal({
      manufacturer: "Corning",
      color: "Yellow",
    });
  });

  it("shows the new fields on labels and shipping documents", () => {
    const caseItem = CaseItemSchema.parse({
      id: caseId,
      upc: "010000000001",
      sku: "FBR-LC-12-100",
      batch: "B1",
      quantityInCase: 12,
      description: "LC 12ct fiber",
      manufacturer: "Corning",
      color: "Yellow",
      putawayLocationId: locationId,
    });
    const pallet = PalletSchema.parse({
      id: palletId,
      palletNumber: "P1",
      trackingNumber: "1Z999AA10123456784",
      cases: [caseItem],
    });
    const receiving = {
      orderNumber: "RCV-1",
      poNumber: "PO-9",
      vendor: "Corning",
      pallets: [pallet],
    } as ReceivingOrder;
    const inbound = buildInboundLabels(receiving);
    expect(inbound[0].fields).to.deep.include({
      label: "Manufacturer",
      value: "Corning",
    });
    expect(inbound[0].fields).to.deep.include({
      label: "Color",
      value: "Yellow",
    });
    expect(inbound[0].fields).to.deep.include({
      label: "Tracking",
      value: "1Z999AA10123456784",
    });

    const shipping = {
      shipmentNumber: "OUT-44",
      customer: "Acme Fiber",
      carrierOutbound: "Estes",
      shipperName: "Jordan Associate",
      shippedAt: "2026-08-21T12:00:00.000Z",
      pallets: [pallet],
    } as ShippingOrder;
    const outbound = buildOutboundLabels(
      shipping,
      new Map([[locationId, "A-01-01"]]),
    );
    expect(outbound[0].fields).to.deep.include({
      label: "Tracking",
      value: "1Z999AA10123456784",
    });

    const slip = buildPackSlip(shipping, new Map([[locationId, "A-01-01"]]));
    expect(slip.lines[0].manufacturer).to.equal("Corning");
    expect(slip.lines[0].color).to.equal("Yellow");
    expect(slip.lines[0].trackingNumber).to.equal("1Z999AA10123456784");

    const manifest = buildLoadManifest(
      shipping,
      new Map([[locationId, "A-01-01"]]),
    );
    expect(manifest.pallets[0].trackingNumber).to.equal("1Z999AA10123456784");
    expect(formatPalletHeading(pallet)).to.equal(
      "Pallet P1 · tracking 1Z999AA10123456784",
    );
    expect(formatCaseItemLine(caseItem)).to.equal(
      "FBR-LC-12-100 · UPC 010000000001 · qty 12 · Corning · Yellow",
    );
  });
});

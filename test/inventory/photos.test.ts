import { describe, it } from "mocha";
import { expect } from "chai";
import {
  PhotoAttachmentSchema,
  PhotoFileNameSchema,
  PhotoOwnerTypeSchema,
} from "@/lib/inventory-schema";
import {
  assertPhotoBytes,
  assertPhotoCollectionRoom,
  extensionForMime,
  sniffImageMime,
} from "@/lib/photos/image";
import { photosForOwner, photosForReference } from "@/lib/photos/query";
import {
  permissionForPhotoWrite,
  resolvePhotoOwner,
} from "@/lib/photos/owner";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";
import { createId } from "@/backend/server/helperUtils";

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(12);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

describe("transaction proof photos", () => {
  it("sniffs jpeg, png, and webp magic bytes and rejects other files", () => {
    expect(sniffImageMime(jpegBytes())).to.equal("image/jpeg");
    expect(sniffImageMime(pngBytes())).to.equal("image/png");
    expect(sniffImageMime(webpBytes())).to.equal("image/webp");
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).to.equal(
      null,
    );
    expect(sniffImageMime(new Uint8Array(8))).to.equal(null);
    expect(extensionForMime("image/jpeg")).to.equal("jpg");
  });

  it("rejects oversized or non-image uploads and caps collection size", () => {
    expect(() => assertPhotoBytes(new Uint8Array(4))).to.throw(
      ValidationError,
      /too small/i,
    );
    const tooBig = new Uint8Array(LIMITS.photoMaxBytes + 1);
    tooBig.set([0xff, 0xd8, 0xff], 0);
    expect(() => assertPhotoBytes(tooBig)).to.throw(ValidationError, /MB or smaller/);
    expect(assertPhotoBytes(jpegBytes())).to.equal("image/jpeg");

    expect(() => assertPhotoCollectionRoom(LIMITS.photoMaxCount)).to.throw(
      ValidationError,
      /at most/i,
    );
    expect(() => assertPhotoCollectionRoom(0, 1)).to.not.throw();
  });

  it("sanitizes photo filenames and accepts attachment metadata", () => {
    expect(PhotoFileNameSchema.parse("../../etc/passwd.jpg")).to.equal(
      "passwd.jpg",
    );
    expect(PhotoFileNameSchema.parse("")).to.equal("photo");
    expect(PhotoOwnerTypeSchema.parse("shipping-order")).to.equal(
      "shipping-order",
    );

    const parsed = PhotoAttachmentSchema.parse({
      id: createId(),
      ownerType: "receiving-order",
      ownerId: createId(),
      originalName: "dock/pallet-1.jpg",
      mimeType: "image/jpeg",
      size: 1200,
      caption: "Seal intact",
      createdAt: new Date().toISOString(),
      createdBy: "Jordan Associate",
    });
    expect(parsed.originalName).to.equal("pallet-1.jpg");
    expect(parsed.caption).to.equal("Seal intact");
  });

  it("resolves receiving, shipping, and damage owners and blocks cancelled orders", () => {
    const receivingId = createId();
    const shippingId = createId();
    const adjustmentId = createId();
    const system = {
      receivingOrders: [
        { id: receivingId, status: "received" },
        { id: createId(), status: "cancelled" },
      ],
      shippingOrders: [{ id: shippingId, status: "shipped" }],
      transactions: [
        { referenceType: "adjustment", referenceId: adjustmentId },
      ],
    };

    expect(resolvePhotoOwner(system, "receiving-order", receivingId).ok).to.equal(
      true,
    );
    expect(
      resolvePhotoOwner(system, "receiving-order", system.receivingOrders[1].id)
        .ok,
    ).to.equal(false);
    expect(resolvePhotoOwner(system, "shipping-order", shippingId).ok).to.equal(
      true,
    );
    expect(resolvePhotoOwner(system, "adjustment", adjustmentId).ok).to.equal(
      true,
    );
    expect(resolvePhotoOwner(system, "adjustment", createId()).ok).to.equal(
      false,
    );
    expect(permissionForPhotoWrite("receiving-order")).to.equal("receive");
    expect(permissionForPhotoWrite("shipping-order")).to.equal("ship");
    expect(permissionForPhotoWrite("adjustment")).to.equal("adjustInventory");
  });

  it("groups photos by PO, shipment, or adjustment reference", () => {
    const receivingId = createId();
    const shippingId = createId();
    const photos = [
      {
        id: createId(),
        ownerType: "receiving-order" as const,
        ownerId: receivingId,
        originalName: "po.jpg",
        mimeType: "image/jpeg" as const,
        size: 100,
        createdAt: new Date().toISOString(),
      },
      {
        id: createId(),
        ownerType: "shipping-order" as const,
        ownerId: shippingId,
        originalName: "bol.jpg",
        mimeType: "image/jpeg" as const,
        size: 100,
        createdAt: new Date().toISOString(),
      },
    ];

    expect(photosForOwner(photos, "receiving-order", receivingId)).to.have.length(
      1,
    );
    expect(
      photosForReference(photos, "shipping-order", shippingId),
    ).to.have.length(1);
    expect(photosForReference(photos, "adjustment", createId())).to.have.length(
      0,
    );
  });
});

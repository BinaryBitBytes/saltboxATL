import { describe, it } from "mocha";
import { expect } from "chai";
import { createId, nowIso } from "@/backend/server/helperUtils";
import {
  CreateAdjustmentInputSchema,
  CreateLocationInputSchema,
  CreateRoomInputSchema,
  CubeItemInputSchema,
  LoginInputSchema,
  PublicUserSchema,
  PurchaseDocumentLineSchema,
  PurchaseDocumentSchema,
  UserSchema,
} from "@/lib/inventory-schema";
import { purchaseDocumentView } from "@/lib/documents/view";
import { hydrateForDom, hydrateInventoryForDom, sanitizeDomStrings } from "@/lib/validation/dom-hydration";
import { sanitizeDomText } from "@/lib/validation/sanitize";
import { schemaRetainsPrivateFields } from "@/lib/validation/schema-privacy";
import { assertNoSensitiveUserFields } from "@/lib/validation/user-security";
import { ValidationError } from "@/lib/validation/errors";
import { makeUser } from "../helpers";

describe("DOM hydration and schema privacy", () => {
  it("keeps credential and price fields on the schema", () => {
    expect(schemaRetainsPrivateFields()).to.equal(true);
    const user = makeUser({ passwordHash: "scrypt:schema-scope" });
    expect(UserSchema.safeParse(user).success).to.equal(true);
    const { passwordHash, ...withoutHash } = user;
    expect(passwordHash).to.equal("scrypt:schema-scope");
    expect(UserSchema.safeParse(withoutHash).success).to.equal(false);
    expect(UserSchema.shape.passwordHash.meta()?.scope).to.equal("private");
    expect(PurchaseDocumentLineSchema.shape.unitPrice.meta()?.scope).to.equal("private");
    expect(PurchaseDocumentLineSchema.shape.extendedPrice.meta()?.scope).to.equal("private");
  });

  it("drops private keys from the hydrated copy and leaves the source intact", () => {
    const user = makeUser({ passwordHash: "scrypt:do-not-hydrate" });
    const source = {
      users: [user],
      nested: {
        password: "saltbox123",
        password_hash: "scrypt:do-not-hydrate",
        api_key: "sk_live_secret",
        accessToken: "tok",
        note: "Seal <script>alert(1)</script> checked\u0000",
      },
    };
    const hydrated = hydrateForDom(source);

    expect(user.passwordHash).to.equal("scrypt:do-not-hydrate");
    expect(source.nested.password).to.equal("saltbox123");
    expect(hydrated.users[0]).to.not.have.property("passwordHash");
    expect(hydrated.nested).to.not.have.property("password");
    expect(hydrated.nested).to.not.have.property("password_hash");
    expect(hydrated.nested).to.not.have.property("api_key");
    expect(hydrated.nested).to.not.have.property("accessToken");
    expect(hydrated.nested.note).to.equal("Seal alert(1) checked");
    expect(PublicUserSchema.safeParse(hydrated.users[0]).success).to.equal(true);

    const serialized = JSON.stringify(hydrated);
    expect(serialized).to.not.include("scrypt:do-not-hydrate");
    expect(serialized).to.not.include("saltbox123");
    expect(serialized).to.not.include("sk_live_secret");
    expect(serialized).to.not.include("<script>");
  });

  it("sanitizes text without treating a password field-error key as a secret", () => {
    expect(sanitizeDomText("<script>alert(1)</script>")).to.equal("alert(1)");
    expect(sanitizeDomText("<scr<script>ipt>alert(1)</script>")).to.not.include("<");
    expect(sanitizeDomText("Fiber <b>cable</b>")).to.equal("Fiber cable");
    expect(sanitizeDomText("AT&T 5 < 10")).to.equal("AT&T 5 < 10");
    const errors = sanitizeDomStrings({
      password: ["Password must include a number."],
      name: ["<b>Riley</b>"],
    });
    expect(errors.password).to.deep.equal(["Password must include a number."]);
    expect(errors.name).to.deep.equal(["Riley"]);
    expect(hydrateForDom(errors)).to.not.have.property("password");
  });

  it("still accepts a login password on the schema, then strips it for the DOM", () => {
    expect(() => assertNoSensitiveUserFields({ password: "saltbox123" })).not.to.throw();
    expect(() => assertNoSensitiveUserFields({ api_key: "sk_live" })).to.throw(
      ValidationError,
      /credential secrets/i,
    );
    expect(() => assertNoSensitiveUserFields({ "Password-Hash": "scrypt:nope" })).to.throw(
      ValidationError,
    );

    const login = LoginInputSchema.parse({
      identifier: "user",
      password: "saltbox123",
    });
    expect(login.password).to.equal("saltbox123");
    const domLogin = hydrateForDom(login);
    expect(domLogin).to.not.have.property("password");
    expect(JSON.stringify(domLogin)).to.not.include("saltbox123");
  });

  it("rejects markup on location, room, cube, adjustment, and keeps invoice prices in schema scope", () => {
    const roomId = createId();
    expect(
      CreateLocationInputSchema.safeParse({
        code: "A-01-01",
        roomId,
        storageClass: "rack",
        description: "<img src=x onerror=alert(1)>",
      }).success,
    ).to.equal(false);
    expect(
      CreateRoomInputSchema.safeParse({
        name: "Dock",
        description: "north\u0000wall",
      }).success,
    ).to.equal(false);
    expect(
      CubeItemInputSchema.safeParse({
        sku: "FBR-LC-12-100",
        description: "<script>x</script>",
        lengthInches: 1,
        widthInches: 1,
        heightInches: 1,
      }).success,
    ).to.equal(false);
    expect(
      CreateAdjustmentInputSchema.safeParse({
        type: "overage",
        quantity: 1,
        reason: "Cycle count",
        scannedCode: '{"v":1,"type":"item","sku":"FBR-LC-12-100"}',
      }).success,
    ).to.equal(true);
    expect(
      CreateAdjustmentInputSchema.safeParse({
        type: "overage",
        quantity: 1,
        reason: "Cycle count",
        description: "<b>nope</b>",
      }).success,
    ).to.equal(false);

    const document = PurchaseDocumentSchema.parse({
      id: createId(),
      purchaseOrderNumber: "PO-100",
      kind: "invoice",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 1200,
      recognitionSource: "embedded-text",
      lines: [
        {
          sku: "FBR-LC-12-100",
          upc: "010000000001",
          description: "LC <b>fiber</b>",
          quantity: 12,
          unitPrice: "$4.50",
          extendedPrice: "$54.00",
        },
      ],
      createdAt: nowIso(),
    });
    expect(document.lines[0].unitPrice).to.equal("$4.50");
    expect(document.lines[0].description).to.equal("LC <b>fiber</b>");

    const hidden = purchaseDocumentView(document, {
      canOpenFile: false,
      canUpload: false,
      canSeePrices: false,
    });
    expect(hidden.lines[0].description).to.equal("LC fiber");
    expect(hidden.lines[0].unitPrice).to.equal(null);
    expect(JSON.stringify(hidden)).to.not.include("$4.50");
    expect(JSON.stringify(hidden)).to.not.include("$54.00");
    expect(JSON.stringify(hidden)).to.not.include("<b>");
    expect(document.lines[0].unitPrice).to.equal("$4.50");

    const shown = purchaseDocumentView(document, {
      canOpenFile: false,
      canUpload: true,
      canSeePrices: true,
    });
    expect(shown.lines[0].unitPrice).to.equal("$4.50");
    expect(shown.lines[0].description).to.equal("LC fiber");
  });

  it("hydrates a warehouse snapshot without copying user secrets into the DOM payload", () => {
    const user = makeUser({ passwordHash: "scrypt:warehouse" });
    const hydrated = hydrateInventoryForDom({
      users: [user],
      purchaseOrders: [],
      purchaseDocuments: [],
      receivingOrders: [],
      shippingOrders: [],
      customerOrders: [],
      inventoryItems: [],
      locations: [],
      rooms: [],
      transactions: [],
      photos: [],
      itemCubes: [],
    });
    expect(user.passwordHash).to.equal("scrypt:warehouse");
    expect(hydrated.users[0]).to.not.have.property("passwordHash");
    expect(JSON.stringify(hydrated)).to.not.include("scrypt:warehouse");
    expect(hydrated.users[0].email).to.equal(user.email);
  });
});

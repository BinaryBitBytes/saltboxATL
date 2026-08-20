import { describe, it } from "mocha";
import { expect } from "chai";
import { toPublicUser, assertNoSensitiveUserFields, assertSafePublicUser } from "@/lib/validation/user-security";
import { ValidationError } from "@/lib/validation/errors";
import { CreateUserInputSchema, PublicUserSchema } from "@/lib/inventory-schema";
import { makeUser } from "../helpers";

describe("user data security", () => {
  it("strips password hashes from public user records", () => {
    const user = makeUser();
    const publicUser = toPublicUser(user);
    expect(publicUser).not.to.have.property("passwordHash");
    expect(publicUser.email).to.equal(user.email);
    expect(PublicUserSchema.parse(user)).not.to.have.property("passwordHash");
  });

  it("rejects public payloads that still contain secrets", () => {
    expect(() =>
      assertSafePublicUser({
        id: makeUser().id,
        name: "Riley User",
        email: "user@saltbox.local",
        role: "user",
        isActive: true,
        passwordHash: "scrypt:ab:cd",
      }),
    ).to.throw(ValidationError, /secret/i);
  });

  it("rejects passwordHash and session fields on user input", () => {
    expect(() =>
      assertNoSensitiveUserFields({
        name: "Casey",
        email: "casey@saltbox.local",
        password: "password1",
        passwordHash: "scrypt:stolen",
      }),
    ).to.throw(ValidationError, /credential secrets/i);

    expect(() =>
      assertNoSensitiveUserFields({ token: "abc" }),
    ).to.throw(ValidationError);
  });

  it("rejects extra privilege fields when creating a user", () => {
    const result = CreateUserInputSchema.safeParse({
      name: "Casey New",
      email: "casey@saltbox.local",
      password: "password1",
      role: "user",
      passwordHash: "scrypt:nope",
      isActive: true,
    });
    expect(result.success).to.equal(false);
  });
});

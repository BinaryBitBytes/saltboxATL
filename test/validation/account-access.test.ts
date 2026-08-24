import { describe, it } from "mocha";
import { expect } from "chai";
import {
  CreateUserInputSchema,
  LoginInputSchema,
  RecoverUsernameInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
} from "@/lib/inventory-schema";
import { UsernameSchema } from "@/lib/validation/fields";
import { LIMITS } from "@/lib/validation/limits";
import {
  backfillUsernames,
  uniqueUsernameFromEmail,
} from "@/lib/auth/username";
import {
  findUserByLoginIdentifier,
  findUserForPasswordReset,
  findUserForUsernameRecovery,
} from "@/lib/auth/account-identity";
import { makeUser } from "../helpers";

const validRegister = {
  name: "Casey New",
  username: "casey",
  email: "casey@saltbox.local",
  password: "saltbox123",
  confirmPassword: "saltbox123",
};

describe("account registration and recovery", () => {
  it("validates usernames and rejects email-shaped or short values", () => {
    expect(UsernameSchema.safeParse("casey").success).to.equal(true);
    expect(UsernameSchema.safeParse("Casey.New_1").success).to.equal(true);
    expect(UsernameSchema.parse("  Casey  ")).to.equal("casey");
    expect(UsernameSchema.safeParse("ab").success).to.equal(false);
    expect(UsernameSchema.safeParse("1casey").success).to.equal(false);
    expect(UsernameSchema.safeParse("casey@saltbox.local").success).to.equal(false);
    expect(UsernameSchema.safeParse("casey<script>").success).to.equal(false);
    expect(UsernameSchema.safeParse("a".repeat(LIMITS.usernameMax + 1)).success).to.equal(
      false,
    );
  });

  it("accepts self-serve registration with matching passwords and no role", () => {
    expect(RegisterInputSchema.safeParse(validRegister).success).to.equal(true);
    expect(
      RegisterInputSchema.safeParse({
        ...validRegister,
        confirmPassword: "saltbox124",
      }).success,
    ).to.equal(false);
    expect(
      RegisterInputSchema.safeParse({
        ...validRegister,
        role: "manager",
      }).success,
    ).to.equal(false);
    expect(
      RegisterInputSchema.safeParse({
        ...validRegister,
        isActive: true,
      }).success,
    ).to.equal(false);
  });

  it("rejects registration passwords that match the username or email", () => {
    expect(
      RegisterInputSchema.safeParse({
        ...validRegister,
        username: "saltbox123",
        password: "saltbox123",
        confirmPassword: "saltbox123",
      }).success,
    ).to.equal(false);
    expect(
      RegisterInputSchema.safeParse({
        ...validRegister,
        email: "saltbox123@saltbox.local",
        password: "saltbox123@saltbox.local",
        confirmPassword: "saltbox123@saltbox.local",
      }).success,
    ).to.equal(false);
  });

  it("requires name and email to recover a username", () => {
    expect(
      RecoverUsernameInputSchema.safeParse({
        name: "Riley User",
        email: "user@saltbox.local",
      }).success,
    ).to.equal(true);
    expect(
      RecoverUsernameInputSchema.safeParse({
        name: "Riley User",
        email: "not-an-email",
      }).success,
    ).to.equal(false);
    expect(
      RecoverUsernameInputSchema.safeParse({
        name: "Riley <b>User</b>",
        email: "user@saltbox.local",
      }).success,
    ).to.equal(false);
  });

  it("requires matching identity fields and a strong password to reset", () => {
    const validReset = {
      name: "Riley User",
      username: "user",
      email: "user@saltbox.local",
      password: "newpass12",
      confirmPassword: "newpass12",
    };
    expect(ResetPasswordInputSchema.safeParse(validReset).success).to.equal(true);
    expect(
      ResetPasswordInputSchema.safeParse({
        ...validReset,
        confirmPassword: "mismatch12",
      }).success,
    ).to.equal(false);
    expect(
      ResetPasswordInputSchema.safeParse({
        ...validReset,
        password: "short",
        confirmPassword: "short",
      }).success,
    ).to.equal(false);
    expect(
      ResetPasswordInputSchema.safeParse({
        ...validReset,
        password: "user",
        confirmPassword: "user",
      }).success,
    ).to.equal(false);
  });

  it("still requires a username when managers create accounts", () => {
    expect(
      CreateUserInputSchema.safeParse({
        name: "Casey New",
        email: "casey@saltbox.local",
        password: "saltbox123",
        role: "user",
      }).success,
    ).to.equal(false);
    expect(
      CreateUserInputSchema.safeParse({
        name: "Casey New",
        username: "casey",
        email: "casey@saltbox.local",
        password: "saltbox123",
        role: "user",
      }).success,
    ).to.equal(true);
  });

  it("prefers identifier, then email, then username for login", () => {
    expect(
      LoginInputSchema.parse({
        identifier: "casey",
        email: "ignored@saltbox.local",
        password: "x",
      }).identifier,
    ).to.equal("casey");
    expect(
      LoginInputSchema.parse({
        email: "Casey@Saltbox.local",
        password: "x",
      }).identifier,
    ).to.equal("casey@saltbox.local");
    expect(
      LoginInputSchema.parse({
        username: "Casey",
        password: "x",
      }).identifier,
    ).to.equal("casey");
  });

  it("backfills unique usernames from email local parts", () => {
    const taken = new Set<string>(["manager"]);
    expect(uniqueUsernameFromEmail("manager@saltbox.local", taken)).to.equal(
      "manager2",
    );
    expect(uniqueUsernameFromEmail("123@saltbox.local", new Set())).to.equal("user");

    const users = [
      { email: "manager@saltbox.local" },
      { email: "lead@saltbox.local", username: "MANAGER" },
      { email: "manager@other.local", username: "manager" },
    ];
    expect(backfillUsernames(users)).to.equal(true);
    expect(users[0]?.username).to.equal("manager2");
    expect(users[1]?.username).to.equal("manager");
    expect(users[2]?.username).to.equal("manager3");
  });

  it("matches recovery and login identity without leaking inactive accounts", () => {
    const active = makeUser({
      name: "Riley User",
      username: "riley",
      email: "riley@saltbox.local",
      role: "user",
    });
    const inactive = makeUser({
      name: "Pat Inactive",
      username: "pat",
      email: "pat@saltbox.local",
      role: "user",
      isActive: false,
    });
    const users = [active, inactive];

    expect(findUserByLoginIdentifier(users, "Riley@saltbox.local")?.id).to.equal(
      active.id,
    );
    expect(findUserByLoginIdentifier(users, "riley")?.id).to.equal(active.id);
    expect(
      findUserForUsernameRecovery(users, "  Riley   User ", "RILEY@saltbox.local")
        ?.username,
    ).to.equal("riley");
    expect(
      findUserForUsernameRecovery(users, "Wrong Name", "riley@saltbox.local"),
    ).to.equal(undefined);
    expect(
      findUserForUsernameRecovery(users, "Pat Inactive", "pat@saltbox.local"),
    ).to.equal(undefined);
    expect(
      findUserForPasswordReset(users, {
        name: "Riley User",
        username: "riley",
        email: "riley@saltbox.local",
      })?.id,
    ).to.equal(active.id);
    expect(
      findUserForPasswordReset(users, {
        name: "Riley User",
        username: "wrong",
        email: "riley@saltbox.local",
      }),
    ).to.equal(undefined);
  });
});

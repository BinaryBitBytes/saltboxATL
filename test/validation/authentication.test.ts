import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import {
  assertLoginNotLocked,
  clearFailedLogins,
  getLoginLockRemainingMs,
  recordFailedLogin,
  resetLoginGuardForTests,
} from "@/lib/validation/login-guard";
import { LIMITS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySessionToken } from "@/lib/auth/token";
import { canAccessPath, hasPermission, safeRedirectPath } from "@/lib/auth/permissions";

describe("user authentication safeguards", () => {
  beforeEach(() => {
    resetLoginGuardForTests();
  });

  it("locks an email after too many failed attempts", () => {
    const email = "user@saltbox.local";
    const start = 1_700_000_000_000;
    for (let i = 0; i < LIMITS.loginMaxFailures; i += 1) {
      recordFailedLogin(email, start + i);
    }
    expect(getLoginLockRemainingMs(email, start + 1)).to.be.greaterThan(0);
    expect(() => assertLoginNotLocked(email, start + 1)).to.throw(
      ValidationError,
      /too many failed/i,
    );
  });

  it("clears failures after a successful sign-in", () => {
    const email = "user@saltbox.local";
    recordFailedLogin(email);
    recordFailedLogin(email);
    clearFailedLogins(email);
    expect(getLoginLockRemainingMs(email)).to.equal(0);
    expect(() => assertLoginNotLocked(email)).not.to.throw();
  });

  it("hashes passwords with scrypt and compares them in constant-time", async () => {
    const stored = await hashPassword("saltbox123");
    expect(stored.startsWith("scrypt:")).to.equal(true);
    expect(await verifyPassword("saltbox123", stored)).to.equal(true);
    expect(await verifyPassword("wrong-password", stored)).to.equal(false);
    expect(await verifyPassword("saltbox123", "not-a-hash")).to.equal(false);
  });

  it("rejects tampered or expired session tokens", () => {
    const token = signSession({
      id: "bbbb1111-1111-4111-8111-111111111111",
      email: "manager@saltbox.local",
      name: "Avery Manager",
      role: "manager",
    });
    expect(verifySessionToken(token)?.email).to.equal("manager@saltbox.local");
    expect(verifySessionToken(`${token}x`)).to.equal(null);
    expect(verifySessionToken("not.a.token")).to.equal(null);
    expect(verifySessionToken(undefined)).to.equal(null);

    const expired = signSession(
      {
        id: "bbbb1111-1111-4111-8111-111111111111",
        email: "manager@saltbox.local",
        name: "Avery Manager",
        role: "manager",
      },
      -10,
    );
    expect(verifySessionToken(expired)).to.equal(null);
  });

  it("does not grant warehouse write permissions to the user role", () => {
    expect(hasPermission("user", "viewInventory")).to.equal(true);
    expect(hasPermission("user", "receive")).to.equal(false);
    expect(hasPermission("user", "putaway")).to.equal(false);
    expect(hasPermission("associate", "putaway")).to.equal(true);
    expect(hasPermission("user", "ship")).to.equal(false);
    expect(hasPermission("user", "adjustInventory")).to.equal(false);
    expect(hasPermission("associate", "adjustInventory")).to.equal(false);
    expect(hasPermission("manager", "manageUsers")).to.equal(true);
    expect(canAccessPath("user", "/logbook")).to.equal(true);
    expect(canAccessPath("user", "/shipping")).to.equal(false);
  });

  it("blocks open redirects after login", () => {
    expect(safeRedirectPath("https://evil.example")).to.equal("/");
    expect(safeRedirectPath("//evil.example")).to.equal("/");
    expect(safeRedirectPath("/api/users")).to.equal("/");
    expect(safeRedirectPath("/receiving")).to.equal("/receiving");
    expect(safeRedirectPath("/putaway")).to.equal("/putaway");
  });
});

import { PublicUserSchema, type PublicUser, type User } from "@/lib/inventory-schema";
import { SENSITIVE_USER_KEYS } from "@/lib/validation/limits";
import { ValidationError } from "@/lib/validation/errors";

export function toPublicUser(user: User): PublicUser {
  const publicUser = PublicUserSchema.parse(user);
  assertSafePublicUser(publicUser);
  return publicUser;
}

export function assertSafePublicUser(user: unknown): asserts user is PublicUser {
  if (!user || typeof user !== "object") {
    throw new ValidationError("User record is invalid.");
  }
  const record = user as Record<string, unknown>;
  for (const key of SENSITIVE_USER_KEYS) {
    if (key in record) {
      throw new ValidationError("User payload must not include credential secrets.");
    }
  }
  if ("password" in record) {
    throw new ValidationError("User payload must not include a password.");
  }
}

export function assertNoSensitiveUserFields(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }
  const keys = Object.keys(input);
  for (const key of keys) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    if (
      normalized === "passwordhash" ||
      normalized === "hash" ||
      normalized === "session" ||
      normalized === "token" ||
      normalized === "secret"
    ) {
      throw new ValidationError(
        "Refusing to accept credential secrets in user input.",
        400,
        "SENSITIVE_FIELD_REJECTED",
      );
    }
  }
}

export function publicUserHasNoSecrets(user: PublicUser): boolean {
  return !("passwordHash" in user) && !("password" in user);
}

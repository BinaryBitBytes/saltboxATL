import { PublicUserSchema, type PublicUser, type User } from "@/lib/inventory-schema";
import { hydrateForDom } from "@/lib/validation/dom-hydration";
import { isDomPrivateKey, isInputSecretKey } from "@/lib/validation/schema-privacy";
import { ValidationError } from "@/lib/validation/errors";

export function toPublicUser(user: User): PublicUser {
  const publicUser = hydrateForDom(PublicUserSchema.parse(user));
  assertSafePublicUser(publicUser);
  return publicUser;
}

export function assertSafePublicUser(user: unknown): asserts user is PublicUser {
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    throw new ValidationError("User record is invalid.");
  }
  for (const key of Object.keys(user as Record<string, unknown>)) {
    if (isDomPrivateKey(key)) {
      throw new ValidationError("User payload must not include credential secrets.");
    }
  }
}

export function assertNoSensitiveUserFields(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }
  for (const key of Object.keys(input)) {
    if (isInputSecretKey(key)) {
      throw new ValidationError(
        "Refusing to accept credential secrets in user input.",
        400,
        "SENSITIVE_FIELD_REJECTED",
      );
    }
  }
}

export function publicUserHasNoSecrets(user: PublicUser): boolean {
  return Object.keys(user).every((key) => !isDomPrivateKey(key));
}

import type { User } from "@/lib/inventory-schema";

export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function passwordMatchesIdentity(
  password: string,
  username: string,
  email: string,
): boolean {
  const value = password.toLowerCase();
  return value === username.toLowerCase() || value === email.toLowerCase();
}

export function accountLoginLockKeys(
  user: { email: string; username: string },
  extraIdentifier?: string,
): string[] {
  const keys = new Set([
    user.email.trim().toLowerCase(),
    user.username.trim().toLowerCase(),
  ]);
  if (extraIdentifier?.trim()) {
    keys.add(extraIdentifier.trim().toLowerCase());
  }
  return [...keys];
}

export function usernameRecoveryLockKey(email: string): string {
  return `recover-username:${email.trim().toLowerCase()}`;
}

export function passwordResetLockKey(email: string): string {
  return `reset-password:${email.trim().toLowerCase()}`;
}

export function findUserByLoginIdentifier(
  users: readonly User[],
  identifier: string,
): User | undefined {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes("@")) {
    return users.find((user) => user.email === normalized);
  }
  return users.find((user) => user.username === normalized);
}

export function findUserForUsernameRecovery(
  users: readonly User[],
  name: string,
  email: string,
): User | undefined {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = normalizePersonName(name);
  return users.find(
    (user) =>
      user.isActive &&
      user.email === normalizedEmail &&
      normalizePersonName(user.name) === normalizedName,
  );
}

export function findUserForPasswordReset(
  users: readonly User[],
  input: { username: string; email: string; name: string },
): User | undefined {
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const name = normalizePersonName(input.name);
  return users.find(
    (user) =>
      user.isActive &&
      user.username === username &&
      user.email === email &&
      normalizePersonName(user.name) === name,
  );
}

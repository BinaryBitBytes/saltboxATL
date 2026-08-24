import { createId, nowIso } from "@/backend/server/helperUtils";
import type { InventoryItem, Location, User } from "@/lib/inventory-schema";
import { uniqueUsernameFromEmail } from "@/lib/auth/username";

export function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: createId(),
    code: "A-01-01",
    roomId: createId(),
    description: "Test bin",
    isActive: true,
    ...overrides,
  };
}

export function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  const now = nowIso();
  return {
    id: createId(),
    sku: "FBR-LC-12-100",
    upc: "010000000001",
    batch: null,
    locationId: createId(),
    quantity: 10,
    description: "Test fiber",
    lastMovedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  const now = nowIso();
  const email = overrides.email ?? "manager@saltbox.local";
  const username =
    overrides.username ?? uniqueUsernameFromEmail(email, new Set());
  return {
    id: createId(),
    name: "Avery Manager",
    username,
    email,
    passwordHash: "scrypt:ab:cd",
    role: "manager",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

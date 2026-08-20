import { createId, nowIso } from "@/backend/server/helperUtils";
import type { InventoryItem, Location, User } from "@/lib/inventory-schema";

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
  return {
    id: createId(),
    name: "Avery Manager",
    email: "manager@saltbox.local",
    passwordHash: "scrypt:ab:cd",
    role: "manager",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

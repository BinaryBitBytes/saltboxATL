import type {
  InventoryItem,
  InventorySystem,
  User,
  UserRole,
} from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { hashPassword } from "@/lib/auth/password";

const ROOM_RECEIVING = "11111111-1111-4111-8111-111111111111";
const ROOM_FIBER = "22222222-2222-4222-8222-222222222222";
const ROOM_WAREHOUSE = "33333333-3333-4333-8333-333333333333";
const ROOM_DAMAGED = "44444444-4444-4444-8444-444444444444";

const LOC_DOCK = "aaaa1111-1111-4111-8111-111111111111";
const LOC_FIBER = "aaaa2222-2222-4222-8222-222222222222";
const LOC_A0101 = "aaaa3333-3333-4333-8333-333333333333";
const LOC_A0102 = "aaaa4444-4444-4444-8444-444444444444";
export const LOC_DAMAGED = "aaaa5555-5555-4555-8555-555555555555";

const USER_MANAGER = "bbbb1111-1111-4111-8111-111111111111";
const USER_ASSOCIATE = "bbbb2222-2222-4222-8222-222222222222";
const USER_VIEWER = "bbbb3333-3333-4333-8333-333333333333";

export const DEMO_PASSWORD = "saltbox123";

export const DEMO_ACCOUNTS: Array<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
}> = [
  {
    id: USER_MANAGER,
    name: "Avery Manager",
    email: "manager@saltbox.local",
    role: "manager",
  },
  {
    id: USER_ASSOCIATE,
    name: "Jordan Associate",
    email: "associate@saltbox.local",
    role: "associate",
  },
  {
    id: USER_VIEWER,
    name: "Riley User",
    email: "user@saltbox.local",
    role: "user",
  },
];

function sampleItem(
  sku: string,
  upc: string,
  locationId: string,
  quantity: number,
  description: string,
  batch: string | null = null,
): InventoryItem {
  const now = nowIso();
  return {
    id: createId(),
    sku,
    upc,
    batch,
    locationId,
    quantity,
    description,
    lastMovedAt: now,
    updatedAt: now,
  };
}

export function createSeedSystem(): InventorySystem {
  return {
    purchaseOrders: [],
    receivingOrders: [],
    shippingOrders: [],
    rooms: [
      {
        id: ROOM_RECEIVING,
        name: "Receiving Dock",
        description: "Inbound staging",
      },
      {
        id: ROOM_FIBER,
        name: "Fiber Room",
        description: "Fiber cable and connector stock",
      },
      {
        id: ROOM_WAREHOUSE,
        name: "Warehouse A",
        description: "Primary putaway floor",
      },
      {
        id: ROOM_DAMAGED,
        name: "Damaged Hold",
        description: "Quarantine for damaged product",
      },
    ],
    locations: [
      {
        id: LOC_DOCK,
        code: "DOCK-01",
        roomId: ROOM_RECEIVING,
        description: "Inbound pallet lane 1",
        isActive: true,
      },
      {
        id: LOC_FIBER,
        code: "FIBER-A1",
        roomId: ROOM_FIBER,
        description: "Fiber rack A1",
        isActive: true,
      },
      {
        id: LOC_A0101,
        code: "A-01-01",
        roomId: ROOM_WAREHOUSE,
        description: "Aisle A, bay 01, level 01",
        isActive: true,
      },
      {
        id: LOC_A0102,
        code: "A-01-02",
        roomId: ROOM_WAREHOUSE,
        description: "Aisle A, bay 01, level 02",
        isActive: true,
      },
      {
        id: LOC_DAMAGED,
        code: "DMG-01",
        roomId: ROOM_DAMAGED,
        description: "Damaged / quarantine cage",
        isActive: true,
      },
    ],
    inventoryItems: [
      sampleItem(
        "FBR-LC-12-100",
        "010000000001",
        LOC_FIBER,
        24,
        "12-strand LC fiber, 100m",
      ),
      sampleItem(
        "CAT6-BLU-1000",
        "010000000002",
        LOC_A0101,
        48,
        "Cat6 blue 1000ft box",
      ),
      sampleItem(
        "FBR-MPO-24-50",
        "010000000003",
        LOC_FIBER,
        12,
        "24-strand MPO trunk, 50m",
        "B2026-08",
      ),
    ],
    transactions: [],
    users: [],
  };
}

export function ensureSystemDefaults(system: InventorySystem): InventorySystem {
  if (!system.transactions) system.transactions = [];

  if (!system.rooms.some((room) => room.id === ROOM_DAMAGED)) {
    system.rooms.push({
      id: ROOM_DAMAGED,
      name: "Damaged Hold",
      description: "Quarantine for damaged product",
    });
  }
  if (!system.locations.some((location) => location.code === "DMG-01")) {
    system.locations.push({
      id: LOC_DAMAGED,
      code: "DMG-01",
      roomId: ROOM_DAMAGED,
      description: "Damaged / quarantine cage",
      isActive: true,
    });
  }
  return system;
}

export async function ensureDemoUsers(
  system: InventorySystem,
): Promise<boolean> {
  if (!system.users) system.users = [];

  let changed = false;
  const now = nowIso();
  for (const account of DEMO_ACCOUNTS) {
    if (system.users.some((user) => user.email === account.email)) {
      continue;
    }
    const user: User = {
      id: account.id,
      name: account.name,
      email: account.email,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: account.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: "system",
    };
    system.users.push(user);
    changed = true;
  }
  return changed;
}

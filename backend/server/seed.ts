import type {
  InventoryItem,
  InventorySystem,
  ItemCube,
  Location,
  User,
  UserRole,
} from "@/lib/inventory-schema";
import { createId, nowIso } from "@/backend/server/helperUtils";
import { hashPassword } from "@/lib/auth/password";
import {
  DEFAULT_HOLD_CUBE_CUBIC_INCHES,
  DEFAULT_PALLET_CUBE_CUBIC_INCHES,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  DEFAULT_STAGING_CUBE_CUBIC_INCHES,
  type StorageClass,
} from "@/lib/cubing/measure";

const ROOM_RECEIVING = "11111111-1111-4111-8111-111111111111";
const ROOM_FIBER = "22222222-2222-4222-8222-222222222222";
const ROOM_WAREHOUSE = "33333333-3333-4333-8333-333333333333";
const ROOM_DAMAGED = "44444444-4444-4444-8444-444444444444";

const LOC_DOCK = "aaaa1111-1111-4111-8111-111111111111";
const LOC_FIBER = "aaaa2222-2222-4222-8222-222222222222";
const LOC_A0101 = "aaaa3333-3333-4333-8333-333333333333";
const LOC_A0102 = "aaaa4444-4444-4444-8444-444444444444";
export const LOC_DAMAGED = "aaaa5555-5555-4555-8555-555555555555";
const LOC_PLT01 = "aaaa6666-6666-4666-8666-666666666666";
const LOC_PLT02 = "aaaa7777-7777-4777-8777-777777777777";

const USER_MANAGER = "bbbb1111-1111-4111-8111-111111111111";
const USER_ASSOCIATE = "bbbb2222-2222-4222-8222-222222222222";
const USER_VIEWER = "bbbb3333-3333-4333-8333-333333333333";

export const DEMO_PASSWORD = "saltbox123";

export const DEMO_ACCOUNTS: Array<{
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
}> = [
  {
    id: USER_MANAGER,
    name: "Avery Manager",
    username: "manager",
    email: "manager@saltbox.local",
    role: "manager",
  },
  {
    id: USER_ASSOCIATE,
    name: "Jordan Associate",
    username: "associate",
    email: "associate@saltbox.local",
    role: "associate",
  },
  {
    id: USER_VIEWER,
    name: "Riley User",
    username: "user",
    email: "user@saltbox.local",
    role: "user",
  },
];

function sampleLocation(
  id: string,
  code: string,
  roomId: string,
  description: string,
  storageClass: StorageClass,
  cubeCapacityCubicInches: number,
): Location {
  return {
    id,
    code,
    roomId,
    description,
    isActive: true,
    storageClass,
    cubeCapacityCubicInches,
  };
}

function sampleCube(
  sku: string,
  lengthInches: number,
  widthInches: number,
  heightInches: number,
  description: string,
): ItemCube {
  const cubicInches = Math.round(lengthInches * widthInches * heightInches * 1000) / 1000;
  return {
    sku,
    description,
    lengthInches,
    widthInches,
    heightInches,
    cubicInches,
    unitsPerCase: 1,
    cubedAt: nowIso(),
    cubedBy: "system",
  };
}

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
    manufacturer: "",
    color: null,
    fiber: null,
    lastMovedAt: now,
    updatedAt: now,
  };
}

export function createSeedSystem(): InventorySystem {
  return {
    purchaseOrders: [],
    receivingOrders: [],
    shippingOrders: [],
    customerOrders: [],
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
      sampleLocation(
        LOC_DOCK,
        "DOCK-01",
        ROOM_RECEIVING,
        "Inbound pallet lane 1",
        "staging",
        DEFAULT_STAGING_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_FIBER,
        "FIBER-A1",
        ROOM_FIBER,
        "Fiber rack A1",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_A0101,
        "A-01-01",
        ROOM_WAREHOUSE,
        "Aisle A, bay 01, level 01",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_A0102,
        "A-01-02",
        ROOM_WAREHOUSE,
        "Aisle A, bay 01, level 02",
        "rack",
        DEFAULT_RACK_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_PLT01,
        "PLT-01",
        ROOM_WAREHOUSE,
        "Full pallet location 1",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_PLT02,
        "PLT-02",
        ROOM_WAREHOUSE,
        "Full pallet location 2",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
      sampleLocation(
        LOC_DAMAGED,
        "DMG-01",
        ROOM_DAMAGED,
        "Damaged / quarantine cage",
        "hold",
        DEFAULT_HOLD_CUBE_CUBIC_INCHES,
      ),
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
    photos: [],
    users: [],
    itemCubes: [
      sampleCube("FBR-LC-12-100", 12.25, 8.25, 3.25, "12-strand LC fiber, 100m"),
      sampleCube("CAT6-BLU-1000", 8, 6, 4, "Cat6 blue 1000ft box"),
      sampleCube("FBR-MPO-24-50", 10.25, 8.25, 4.25, "24-strand MPO trunk, 50m"),
    ],
  };
}

export function ensureSystemDefaults(system: InventorySystem): InventorySystem {
  if (!system.transactions) system.transactions = [];
  if (!system.photos) system.photos = [];
  if (!system.itemCubes) system.itemCubes = [];
  if (!system.customerOrders) system.customerOrders = [];

  for (const location of system.locations) {
    if (
      location.code === "DOCK-01" &&
      location.storageClass === "rack" &&
      location.cubeCapacityCubicInches === DEFAULT_RACK_CUBE_CUBIC_INCHES
    ) {
      location.storageClass = "staging";
      location.cubeCapacityCubicInches = DEFAULT_STAGING_CUBE_CUBIC_INCHES;
    }
    if (
      location.code === "DMG-01" &&
      location.storageClass === "rack" &&
      location.cubeCapacityCubicInches === DEFAULT_RACK_CUBE_CUBIC_INCHES
    ) {
      location.storageClass = "hold";
      location.cubeCapacityCubicInches = DEFAULT_HOLD_CUBE_CUBIC_INCHES;
    }
  }

  const warehouse =
    system.rooms.find((room) => room.id === ROOM_WAREHOUSE) ??
    system.rooms.find((room) => room.name === "Warehouse A");
  if (warehouse && !system.locations.some((location) => location.code === "PLT-01")) {
    system.locations.push(
      sampleLocation(
        LOC_PLT01,
        "PLT-01",
        warehouse.id,
        "Full pallet location 1",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
    );
  }
  if (warehouse && !system.locations.some((location) => location.code === "PLT-02")) {
    system.locations.push(
      sampleLocation(
        LOC_PLT02,
        "PLT-02",
        warehouse.id,
        "Full pallet location 2",
        "pallet",
        DEFAULT_PALLET_CUBE_CUBIC_INCHES,
      ),
    );
  }

  if (!system.rooms.some((room) => room.id === ROOM_DAMAGED)) {
    system.rooms.push({
      id: ROOM_DAMAGED,
      name: "Damaged Hold",
      description: "Quarantine for damaged product",
    });
  }
  if (!system.locations.some((location) => location.code === "DMG-01")) {
    system.locations.push(
      sampleLocation(
        LOC_DAMAGED,
        "DMG-01",
        ROOM_DAMAGED,
        "Damaged / quarantine cage",
        "hold",
        DEFAULT_HOLD_CUBE_CUBIC_INCHES,
      ),
    );
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
      username: account.username,
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

import { describe, it } from "mocha";
import { expect } from "chai";
import { InventorySystemSchema } from "@/lib/inventory-schema";
import { createSeedSystem } from "@/backend/server/seed";
import {
  assembleSystem,
  mapItem,
  mapLocation,
  mapPhoto,
  mapPurchaseOrder,
  mapReceivingOrder,
  mapRoom,
  mapShippingOrder,
  mapTransaction,
  mapUser,
} from "@/backend/server/pg-mapper";
import { usesPostgres } from "@/backend/server/db";
import { readFromPostgres, updatePostgres } from "@/backend/server/pg-store";
import { createId, nowIso } from "@/backend/server/helperUtils";

describe("postgresql inventory mapping", () => {
  it("round-trips seed rooms, bins, and items through the row mapper", () => {
    const seed = createSeedSystem();
    const mapped = assembleSystem({
      rooms: seed.rooms.map((room) =>
        mapRoom({
          id: room.id,
          name: room.name,
          description: room.description ?? null,
        }),
      ),
      locations: seed.locations.map((location) =>
        mapLocation({
          id: location.id,
          code: location.code,
          room_id: location.roomId,
          description: location.description ?? null,
          is_active: location.isActive,
        }),
      ),
      users: [],
      inventoryItems: seed.inventoryItems.map((item) =>
        mapItem({
          id: item.id,
          sku: item.sku,
          upc: item.upc ?? null,
          batch: item.batch,
          location_id: item.locationId,
          quantity: item.quantity,
          description: item.description ?? null,
          last_moved_at: item.lastMovedAt ?? null,
          updated_at: item.updatedAt ?? null,
        }),
      ),
      transactions: [],
      photos: [],
      purchaseOrders: [],
      receivingOrders: [],
      shippingOrders: [],
    });
    const parsed = InventorySystemSchema.parse(mapped);
    expect(parsed.rooms).to.have.length(seed.rooms.length);
    expect(parsed.locations.map((location) => location.code)).to.include("A-01-01");
    expect(parsed.inventoryItems.map((item) => item.sku)).to.include("FBR-LC-12-100");
  });

  it("keeps receiving pallet JSON and user credentials through the mapper", () => {
    const now = nowIso();
    const receiving = mapReceivingOrder({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      po_number: "PO-1",
      received_at: now,
      vendor: "Acme",
      order_number: "SO-1",
      carrier_inbound: "UPS",
      receiver_name: "Avery Manager",
      load_pallet_count: 1,
      status: "draft",
      is_partialed: false,
      partialed_at: null,
      partialed_by: null,
      reopened_at: null,
      reopened_by: null,
      working_pallet_id: null,
      pallets: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          palletNumber: "P1",
          isPartial: false,
          partialedBy: null,
          expectedSkuCount: 1,
          actualSkuCount: 1,
          expectedCaseCount: 1,
          actualCaseCount: 1,
          cases: [],
        },
      ],
      notes: null,
      created_at: now,
      updated_at: now,
      created_by: "Avery Manager",
    });
    expect(receiving.pallets[0]?.palletNumber).to.equal("P1");

    const user = mapUser({
      id: "bbbb1111-1111-4111-8111-111111111111",
      name: "Avery Manager",
      username: "manager",
      email: "manager@saltbox.local",
      password_hash: "scrypt:ab:cd",
      role: "manager",
      is_active: true,
      created_at: now,
      updated_at: now,
      created_by: "system",
    });
    expect(user.passwordHash).to.equal("scrypt:ab:cd");
    expect(mapPhoto({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      owner_type: "receiving-order",
      owner_id: receiving.id,
      document_kind: "freight-proof",
      original_name: "dock.jpg",
      mime_type: "image/jpeg",
      size: 12,
      caption: null,
      created_at: now,
      created_by: "Avery Manager",
    }).ownerType).to.equal("receiving-order");
    expect(mapPurchaseOrder({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      purchase_order_number: "PO-1",
      generated_at: now,
      created_at: now,
    }).purchaseOrderNumber).to.equal("PO-1");
    expect(mapShippingOrder({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
      shipped_at: now,
      customer: "Site A",
      shipment_number: "OUT-1",
      carrier_outbound: "FedEx",
      shipper_name: "Jordan Associate",
      load_pallet_count: 0,
      waiting_on_items: false,
      items_in_jeopardy: ["FBR-LC-12-100"],
      status: "draft",
      pallets: [],
      notes: null,
      created_at: now,
      updated_at: now,
      created_by: "Jordan Associate",
    }).itemsInJeopardy).to.deep.equal(["FBR-LC-12-100"]);
    expect(mapTransaction({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
      type: "import",
      occurred_at: now,
      sku: "FBR-LC-12-100",
      upc: "010000000001",
      batch: null,
      inventory_item_id: null,
      location_id: null,
      destination_location_id: null,
      quantity_delta: 4,
      quantity_before: 0,
      quantity_after: 4,
      reason: "Spreadsheet import",
      reference_type: "spreadsheet-import",
      reference_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03",
      scanned_code: null,
      created_by: "Avery Manager",
      notes: null,
    }).quantityDelta).to.equal(4);
    expect(mapLocation({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "A-01-01",
      room_id: "11111111-1111-4111-8111-111111111111",
      description: "bin",
      is_active: true,
    }).roomId).to.equal("11111111-1111-4111-8111-111111111111");
  });

  it("writes and reads inventory through PostgreSQL when DATABASE_URL is set", async function () {
    if (!usesPostgres()) {
      this.skip();
    }
    const marker = `PG-TEST-${Date.now()}`;
    const itemId = createId();
    await updatePostgres((system) => {
      const location = system.locations[0];
      if (!location) throw new Error("seed location missing");
      system.inventoryItems.push({
        id: itemId,
        sku: marker,
        upc: "010000000999",
        batch: null,
        locationId: location.id,
        quantity: 3,
        description: "postgres roundtrip",
        lastMovedAt: nowIso(),
        updatedAt: nowIso(),
      });
    });
    const loaded = await readFromPostgres();
    const row = loaded.inventoryItems.find((item) => item.sku === marker);
    expect(row?.quantity).to.equal(3);
    await updatePostgres((system) => {
      system.inventoryItems = system.inventoryItems.filter((item) => item.sku !== marker);
    });
  });
});

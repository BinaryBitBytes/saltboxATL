import type { PoolClient } from "pg";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import {
  createSeedSystem,
  ensureDemoUsers,
  ensureSystemDefaults,
} from "@/backend/server/seed";
import { withInventoryLock } from "@/backend/server/db";
import { readJsonFile } from "@/backend/server/json-store";
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

export async function loadSystem(client: PoolClient): Promise<InventorySystem> {
  const rooms = await client.query("SELECT * FROM rooms ORDER BY name");
  const locations = await client.query("SELECT * FROM locations ORDER BY code");
  const users = await client.query("SELECT * FROM users ORDER BY email");
  const items = await client.query("SELECT * FROM inventory_items ORDER BY sku, batch, id");
  const transactions = await client.query(
    "SELECT * FROM inventory_transactions ORDER BY occurred_at, id",
  );
  const photos = await client.query("SELECT * FROM photos ORDER BY created_at, id");
  const purchaseOrders = await client.query(
    "SELECT * FROM purchase_orders ORDER BY generated_at, id",
  );
  const receivingOrders = await client.query(
    "SELECT * FROM receiving_orders ORDER BY received_at, id",
  );
  const shippingOrders = await client.query(
    "SELECT * FROM shipping_orders ORDER BY shipped_at, id",
  );

  return InventorySystemSchema.parse(
    assembleSystem({
      rooms: rooms.rows.map(mapRoom),
      locations: locations.rows.map(mapLocation),
      users: users.rows.map(mapUser),
      inventoryItems: items.rows.map(mapItem),
      transactions: transactions.rows.map(mapTransaction),
      photos: photos.rows.map(mapPhoto),
      purchaseOrders: purchaseOrders.rows.map(mapPurchaseOrder),
      receivingOrders: receivingOrders.rows.map(mapReceivingOrder),
      shippingOrders: shippingOrders.rows.map(mapShippingOrder),
    }),
  );
}

export async function saveSystem(
  client: PoolClient,
  system: InventorySystem,
): Promise<void> {
  await client.query("DELETE FROM inventory_transactions");
  await client.query("DELETE FROM photos");
  await client.query("DELETE FROM inventory_items");
  await client.query("DELETE FROM receiving_orders");
  await client.query("DELETE FROM shipping_orders");
  await client.query("DELETE FROM purchase_orders");
  await client.query("DELETE FROM locations");
  await client.query("DELETE FROM rooms");
  await client.query("DELETE FROM users");

  for (const room of system.rooms) {
    await client.query(
      "INSERT INTO rooms (id, name, description) VALUES ($1, $2, $3)",
      [room.id, room.name, room.description ?? null],
    );
  }
  for (const location of system.locations) {
    await client.query(
      `INSERT INTO locations (id, code, room_id, description, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        location.id,
        location.code,
        location.roomId,
        location.description ?? null,
        location.isActive,
      ],
    );
  }
  for (const user of system.users) {
    await client.query(
      `INSERT INTO users (
         id, name, username, email, password_hash, role, is_active,
         created_at, updated_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        user.id,
        user.name,
        user.username,
        user.email,
        user.passwordHash,
        user.role,
        user.isActive,
        user.createdAt ?? null,
        user.updatedAt ?? null,
        user.createdBy ?? null,
      ],
    );
  }
  for (const item of system.inventoryItems) {
    await client.query(
      `INSERT INTO inventory_items (
         id, sku, upc, batch, location_id, quantity, description,
         last_moved_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        item.id,
        item.sku,
        item.upc ?? null,
        item.batch,
        item.locationId,
        item.quantity,
        item.description ?? null,
        item.lastMovedAt ?? null,
        item.updatedAt ?? null,
      ],
    );
  }
  for (const txn of system.transactions) {
    await client.query(
      `INSERT INTO inventory_transactions (
         id, type, occurred_at, sku, upc, batch, inventory_item_id, location_id,
         destination_location_id, quantity_delta, quantity_before, quantity_after,
         reason, reference_type, reference_id, scanned_code, created_by, notes
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       )`,
      [
        txn.id,
        txn.type,
        txn.occurredAt,
        txn.sku,
        txn.upc ?? null,
        txn.batch,
        txn.inventoryItemId,
        txn.locationId,
        txn.destinationLocationId,
        txn.quantityDelta,
        txn.quantityBefore ?? null,
        txn.quantityAfter ?? null,
        txn.reason ?? null,
        txn.referenceType ?? null,
        txn.referenceId ?? null,
        txn.scannedCode ?? null,
        txn.createdBy ?? null,
        txn.notes ?? null,
      ],
    );
  }
  for (const photo of system.photos) {
    await client.query(
      `INSERT INTO photos (
         id, owner_type, owner_id, document_kind, original_name, mime_type,
         size, caption, created_at, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        photo.id,
        photo.ownerType,
        photo.ownerId,
        photo.documentKind,
        photo.originalName,
        photo.mimeType,
        photo.size,
        photo.caption ?? null,
        photo.createdAt,
        photo.createdBy ?? null,
      ],
    );
  }
  for (const order of system.purchaseOrders) {
    await client.query(
      `INSERT INTO purchase_orders (id, purchase_order_number, generated_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [order.id, order.purchaseOrderNumber, order.generatedAt, order.createdAt ?? null],
    );
  }
  for (const order of system.receivingOrders) {
    await client.query(
      `INSERT INTO receiving_orders (
         id, po_number, received_at, vendor, order_number, carrier_inbound,
         receiver_name, load_pallet_count, status, is_partialed, partialed_at,
         partialed_by, reopened_at, reopened_by, working_pallet_id, pallets,
         notes, created_at, updated_at, created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20
       )`,
      [
        order.id,
        order.poNumber,
        order.receivedAt,
        order.vendor,
        order.orderNumber,
        order.carrierInbound,
        order.receiverName,
        order.loadPalletCount,
        order.status,
        order.isPartialed,
        order.partialedAt ?? null,
        order.partialedBy ?? null,
        order.reopenedAt ?? null,
        order.reopenedBy ?? null,
        order.workingPalletId,
        JSON.stringify(order.pallets ?? []),
        order.notes ?? null,
        order.createdAt ?? null,
        order.updatedAt ?? null,
        order.createdBy ?? null,
      ],
    );
  }
  for (const order of system.shippingOrders) {
    await client.query(
      `INSERT INTO shipping_orders (
         id, shipped_at, customer, shipment_number, carrier_outbound, shipper_name,
         load_pallet_count, waiting_on_items, items_in_jeopardy, status, pallets,
         notes, created_at, updated_at, created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )`,
      [
        order.id,
        order.shippedAt,
        order.customer,
        order.shipmentNumber,
        order.carrierOutbound,
        order.shipperName,
        order.loadPalletCount,
        order.waitingOnItems,
        JSON.stringify(order.itemsInJeopardy ?? []),
        order.status,
        JSON.stringify(order.pallets ?? []),
        order.notes ?? null,
        order.createdAt ?? null,
        order.updatedAt ?? null,
        order.createdBy ?? null,
      ],
    );
  }
}

export async function updatePostgres<T>(
  mutator: (system: InventorySystem) => T | Promise<T>,
): Promise<T> {
  return withInventoryLock(async (client) => {
    const system = await loadSeededSystem(client);
    const result = await mutator(system);
    await saveSystem(client, InventorySystemSchema.parse(system));
    return result;
  });
}

async function loadSeededSystem(client: PoolClient): Promise<InventorySystem> {
  let system = await loadSystem(client);
  const empty =
    system.rooms.length === 0 &&
    system.users.length === 0 &&
    system.inventoryItems.length === 0;
  if (empty) {
    system = (await readJsonFile()) ?? createSeedSystem();
  }
  ensureSystemDefaults(system);
  const seededUsers = await ensureDemoUsers(system);
  if (empty || seededUsers) {
    await saveSystem(client, InventorySystemSchema.parse(system));
  }
  return system;
}

export async function readFromPostgres(): Promise<InventorySystem> {
  return withInventoryLock((client) => loadSeededSystem(client));
}

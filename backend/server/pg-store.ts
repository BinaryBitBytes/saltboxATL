import type { PoolClient } from "pg";
import { InventorySystemSchema, type InventorySystem } from "@/lib/inventory-schema";
import {
  createSeedSystem,
  ensureDemoUsers,
  ensureSystemDefaults,
} from "@/backend/server/seed";
import { withInventoryLock } from "@/backend/server/db";
import { readJsonFile } from "@/backend/server/json-store";
import { asDivision, divisionForRole } from "@/lib/divisions";
import {
  assembleSystem,
  mapAisle,
  mapBay,
  mapBuilding,
  mapContainer,
  mapItem,
  mapItemCube,
  mapLicensePlate,
  mapLocation,
  mapPhoto,
  mapPurchaseDocument,
  mapPurchaseOrder,
  mapReceivingOrder,
  mapRoom,
  mapCustomerOrder,
  mapShippingOrder,
  mapSite,
  mapTrailer,
  mapTransaction,
  mapUser,
  mapZone,
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
  const purchaseDocuments = await client.query(
    "SELECT * FROM purchase_documents ORDER BY created_at, id",
  );
  const receivingOrders = await client.query(
    "SELECT * FROM receiving_orders ORDER BY received_at, id",
  );
  const shippingOrders = await client.query(
    "SELECT * FROM shipping_orders ORDER BY shipped_at, id",
  );
  const customerOrders = await client.query(
    "SELECT * FROM customer_orders ORDER BY submitted_at, id",
  );
  const itemCubes = await client.query("SELECT * FROM item_cubes ORDER BY sku");
  const sites = await client.query("SELECT * FROM sites ORDER BY codename");
  const buildings = await client.query("SELECT * FROM buildings ORDER BY number");
  const zones = await client.query("SELECT * FROM zones ORDER BY letter");
  const aisles = await client.query("SELECT * FROM aisles ORDER BY number");
  const bays = await client.query("SELECT * FROM bays ORDER BY number");
  const trailers = await client.query("SELECT * FROM trailers ORDER BY code");
  const licensePlates = await client.query("SELECT * FROM license_plates ORDER BY code");
  const containers = await client.query("SELECT * FROM containers ORDER BY code");

  return InventorySystemSchema.parse(
    assembleSystem({
      rooms: rooms.rows.map(mapRoom),
      locations: locations.rows.map(mapLocation),
      users: users.rows.map(mapUser),
      inventoryItems: items.rows.map(mapItem),
      transactions: transactions.rows.map(mapTransaction),
      photos: photos.rows.map(mapPhoto),
      purchaseOrders: purchaseOrders.rows.map(mapPurchaseOrder),
      purchaseDocuments: purchaseDocuments.rows.map(mapPurchaseDocument),
      receivingOrders: receivingOrders.rows.map(mapReceivingOrder),
      shippingOrders: shippingOrders.rows.map(mapShippingOrder),
      customerOrders: customerOrders.rows.map(mapCustomerOrder),
      itemCubes: itemCubes.rows.map(mapItemCube),
      sites: sites.rows.map(mapSite),
      buildings: buildings.rows.map(mapBuilding),
      zones: zones.rows.map(mapZone),
      aisles: aisles.rows.map(mapAisle),
      bays: bays.rows.map(mapBay),
      trailers: trailers.rows.map(mapTrailer),
      licensePlates: licensePlates.rows.map(mapLicensePlate),
      containers: containers.rows.map(mapContainer),
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
  await client.query("DELETE FROM customer_orders");
  await client.query("DELETE FROM shipping_orders");
  await client.query("DELETE FROM purchase_documents");
  await client.query("DELETE FROM purchase_orders");
  await client.query("DELETE FROM item_cubes");
  await client.query("DELETE FROM containers");
  await client.query("DELETE FROM license_plates");
  await client.query("DELETE FROM locations");
  await client.query("DELETE FROM bays");
  await client.query("DELETE FROM aisles");
  await client.query("DELETE FROM zones");
  await client.query("DELETE FROM buildings");
  await client.query("DELETE FROM trailers");
  await client.query("DELETE FROM sites");
  await client.query("DELETE FROM rooms");
  await client.query("DELETE FROM users");

  for (const room of system.rooms) {
    await client.query(
      "INSERT INTO rooms (id, name, description, division) VALUES ($1, $2, $3, $4)",
      [room.id, room.name, room.description ?? null, asDivision(room.division)],
    );
  }
  for (const site of system.sites) {
    await client.query(
      `INSERT INTO sites (id, division, codename, state, city, name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        site.id,
        asDivision(site.division),
        site.codename,
        site.state,
        site.city,
        site.name,
      ],
    );
  }
  for (const building of system.buildings) {
    await client.query(
      `INSERT INTO buildings (id, division, site_id, number, room_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        building.id,
        asDivision(building.division),
        building.siteId,
        building.number,
        building.roomId,
      ],
    );
  }
  for (const zone of system.zones) {
    await client.query(
      `INSERT INTO zones (
         id, division, building_id, letter, item_type, cube_size, project_id, po_number,
         inbound_velocity, outbound_velocity
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        zone.id,
        asDivision(zone.division),
        zone.buildingId,
        zone.letter,
        zone.itemType,
        zone.cubeSize,
        zone.projectId,
        zone.poNumber,
        zone.inboundVelocity,
        zone.outboundVelocity,
      ],
    );
  }
  for (const aisle of system.aisles) {
    await client.query(
      `INSERT INTO aisles (id, division, zone_id, number) VALUES ($1, $2, $3, $4)`,
      [aisle.id, asDivision(aisle.division), aisle.zoneId, aisle.number],
    );
  }
  for (const bay of system.bays) {
    await client.query(
      `INSERT INTO bays (id, division, aisle_id, number, cube_budget_cubic_inches)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        bay.id,
        asDivision(bay.division),
        bay.aisleId,
        bay.number,
        bay.cubeBudgetCubicInches,
      ],
    );
  }
  for (const trailer of system.trailers) {
    await client.query(
      `INSERT INTO trailers (id, division, site_id, code, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        trailer.id,
        asDivision(trailer.division),
        trailer.siteId,
        trailer.code,
        trailer.status,
      ],
    );
  }
  for (const location of system.locations) {
    await client.query(
      `INSERT INTO locations (
         id, code, room_id, description, is_active, storage_class, cube_capacity_cubic_inches,
         division, bay_id, slot_kind, height, position, side
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        location.id,
        location.code,
        location.roomId,
        location.description ?? null,
        location.isActive,
        location.storageClass,
        location.cubeCapacityCubicInches,
        asDivision(location.division),
        location.bayId ?? null,
        location.slotKind ?? null,
        location.height ?? null,
        location.position ?? null,
        location.side ?? null,
      ],
    );
  }
  for (const plate of system.licensePlates) {
    await client.query(
      `INSERT INTO license_plates (id, division, code, location_id, trailer_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        plate.id,
        asDivision(plate.division),
        plate.code,
        plate.locationId,
        plate.trailerId,
      ],
    );
  }
  for (const container of system.containers) {
    await client.query(
      `INSERT INTO containers (id, division, license_plate_id, code)
       VALUES ($1, $2, $3, $4)`,
      [
        container.id,
        asDivision(container.division),
        container.licensePlateId,
        container.code,
      ],
    );
  }
  for (const user of system.users) {
    await client.query(
      `INSERT INTO users (
         id, name, username, email, password_hash, role, is_active,
         created_at, updated_at, created_by, division
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        user.division === "security" || user.division === "hyperscale"
          ? user.division
          : divisionForRole(user.role),
      ],
    );
  }
  for (const item of system.inventoryItems) {
    await client.query(
      `INSERT INTO inventory_items (
         id, sku, upc, batch, location_id, quantity, description,
         manufacturer, color, is_fiber, connection_type, strand_count, length_meters,
         last_moved_at, updated_at, division, license_plate_id, container_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        item.id,
        item.sku,
        item.upc ?? null,
        item.batch,
        item.locationId,
        item.quantity,
        item.description ?? null,
        item.manufacturer ?? "",
        item.color ?? null,
        item.fiber?.isFiber ?? false,
        item.fiber?.connectionType ?? null,
        item.fiber?.strandCount ?? null,
        item.fiber?.lengthMeters ?? null,
        item.lastMovedAt ?? null,
        item.updatedAt ?? null,
        asDivision(item.division),
        item.licensePlateId ?? null,
        item.containerId ?? null,
      ],
    );
  }
  for (const txn of system.transactions) {
    await client.query(
      `INSERT INTO inventory_transactions (
         id, type, occurred_at, sku, upc, batch, inventory_item_id, location_id,
         destination_location_id, quantity_delta, quantity_before, quantity_after,
         reason, reference_type, reference_id, scanned_code, created_by, notes, division
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
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
        asDivision(txn.division),
      ],
    );
  }
  for (const photo of system.photos) {
    await client.query(
      `INSERT INTO photos (
         id, owner_type, owner_id, document_kind, original_name, mime_type,
         size, caption, created_at, created_by, division
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        asDivision(photo.division),
      ],
    );
  }
  for (const order of system.purchaseOrders) {
    await client.query(
      `INSERT INTO purchase_orders (
         id, purchase_order_number, generated_at, created_at, job_id_number,
         project_id, vendor, carrier, expected_arrival_at, buyer_name,
         expectation_notes, expectation_status, expected_pallet_count, lines,
         uploaded_by, source, division
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
       )`,
      [
        order.id,
        order.purchaseOrderNumber,
        order.generatedAt,
        order.createdAt ?? null,
        order.jobIdNumber ?? null,
        order.projectId ?? null,
        order.vendor ?? null,
        order.carrier ?? null,
        order.expectedArrivalAt ?? null,
        order.buyerName ?? null,
        order.expectationNotes ?? null,
        order.expectationStatus ?? null,
        order.expectedPalletCount ?? null,
        JSON.stringify(order.lines ?? []),
        order.uploadedBy ?? null,
        order.source ?? null,
        asDivision(order.division),
      ],
    );
  }
  for (const order of system.receivingOrders) {
    await client.query(
      `INSERT INTO receiving_orders (
         id, po_number, received_at, vendor, order_number, carrier_inbound,
         receiver_name, load_pallet_count, status, is_partialed, partialed_at,
         partialed_by, reopened_at, reopened_by, working_pallet_id, pallets,
         notes, created_at, updated_at, created_by, division, intake,
         backorder_lines
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, $22, $23
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
        asDivision(order.division),
        order.intake ?? null,
        JSON.stringify(order.backorderLines ?? []),
      ],
    );
  }
  for (const document of system.purchaseDocuments ?? []) {
    await client.query(
      `INSERT INTO purchase_documents (
         id, purchase_order_number, kind, original_name, mime_type, size,
         prices_redacted, recognition_source, recognition_note, job_id_number,
         lines, inbound_load_id, created_at, created_by, division
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )`,
      [
        document.id,
        document.purchaseOrderNumber,
        document.kind,
        document.originalName,
        document.mimeType,
        document.size,
        document.pricesRedacted,
        document.recognitionSource,
        document.recognitionNote ?? null,
        document.jobIdNumber ?? null,
        JSON.stringify(document.lines ?? []),
        document.inboundLoadId ?? null,
        document.createdAt,
        document.createdBy ?? null,
        asDivision(document.division),
      ],
    );
  }
  for (const order of system.shippingOrders) {
    await client.query(
      `INSERT INTO shipping_orders (
         id, shipped_at, customer, shipment_number, carrier_outbound, shipper_name,
         load_pallet_count, waiting_on_items, items_in_jeopardy, status, pallets,
         notes, delivery, created_at, updated_at, created_by, division
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
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
        order.delivery ? JSON.stringify(order.delivery) : null,
        order.createdAt ?? null,
        order.updatedAt ?? null,
        order.createdBy ?? null,
        asDivision(order.division),
      ],
    );
  }
  for (const order of system.customerOrders ?? []) {
    await client.query(
      `INSERT INTO customer_orders (
         id, order_number, customer, placed_by, notes, status, submitted_at,
         lines, print_batch, pick_request, created_at, updated_at, created_by, division
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )`,
      [
        order.id,
        order.orderNumber,
        order.customer,
        order.placedBy,
        order.notes ?? null,
        order.status,
        order.submittedAt,
        JSON.stringify(order.lines),
        JSON.stringify(order.printBatch),
        JSON.stringify(order.pickRequest),
        order.createdAt ?? null,
        order.updatedAt ?? null,
        order.createdBy ?? null,
        asDivision(order.division),
      ],
    );
  }
  for (const cube of system.itemCubes) {
    await client.query(
      `INSERT INTO item_cubes (
         sku, description, length_inches, width_inches, height_inches,
         cubic_inches, units_per_case, cubed_at, cubed_by, division
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        cube.sku,
        cube.description,
        cube.lengthInches,
        cube.widthInches,
        cube.heightInches,
        cube.cubicInches,
        cube.unitsPerCase,
        cube.cubedAt,
        cube.cubedBy ?? null,
        asDivision(cube.division),
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
  const defaultsChanged = ensureSystemDefaults(system);
  const seededUsers = await ensureDemoUsers(system);
  if (empty || seededUsers || defaultsChanged) {
    await client.query("SAVEPOINT seed_users");
    try {
      await saveSystem(client, InventorySystemSchema.parse(system));
      await client.query("RELEASE SAVEPOINT seed_users");
    } catch (error) {
      console.error("Could not persist seeded demo accounts.", error);
      await client.query("ROLLBACK TO SAVEPOINT seed_users");
    }
  }
  return system;
}

export async function readFromPostgres(): Promise<InventorySystem> {
  return withInventoryLock((client) => loadSeededSystem(client));
}

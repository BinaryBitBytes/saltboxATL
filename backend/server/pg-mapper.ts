import type {
  InventoryItem,
  InventorySystem,
  InventoryTransaction,
  Location,
  PhotoAttachment,
  PurchaseOrder,
  ReceivingOrder,
  Room,
  ShippingOrder,
  User,
} from "@/lib/inventory-schema";

export function iso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function isoRequired(value: Date | string | null | undefined): string {
  const converted = iso(value);
  if (!converted) {
    throw new Error("Expected a timestamp.");
  }
  return converted;
}

export function mapRoom(row: {
  id: string;
  name: string;
  description: string | null;
}): Room {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
  };
}

export function mapLocation(row: {
  id: string;
  code: string;
  room_id: string;
  description: string | null;
  is_active: boolean;
}): Location {
  return {
    id: row.id,
    code: row.code,
    roomId: row.room_id,
    description: row.description ?? undefined,
    isActive: row.is_active,
  };
}

export function mapUser(row: {
  id: string;
  name: string;
  username: string;
  email: string;
  password_hash: string;
  role: User["role"];
  is_active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
}): User {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: row.is_active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function mapItem(row: {
  id: string;
  sku: string;
  upc: string | null;
  batch: string | null;
  location_id: string;
  quantity: number;
  description: string | null;
  last_moved_at: Date | string | null;
  updated_at: Date | string | null;
}): InventoryItem {
  return {
    id: row.id,
    sku: row.sku,
    upc: row.upc ?? undefined,
    batch: row.batch,
    locationId: row.location_id,
    quantity: row.quantity,
    description: row.description ?? undefined,
    lastMovedAt: iso(row.last_moved_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapTransaction(row: {
  id: string;
  type: InventoryTransaction["type"];
  occurred_at: Date | string;
  sku: string;
  upc: string | null;
  batch: string | null;
  inventory_item_id: string | null;
  location_id: string | null;
  destination_location_id: string | null;
  quantity_delta: number;
  quantity_before: number | null;
  quantity_after: number | null;
  reason: string | null;
  reference_type: InventoryTransaction["referenceType"] | null;
  reference_id: string | null;
  scanned_code: string | null;
  created_by: string | null;
  notes: string | null;
}): InventoryTransaction {
  return {
    id: row.id,
    type: row.type,
    occurredAt: isoRequired(row.occurred_at),
    sku: row.sku,
    upc: row.upc ?? undefined,
    batch: row.batch,
    inventoryItemId: row.inventory_item_id,
    locationId: row.location_id,
    destinationLocationId: row.destination_location_id,
    quantityDelta: row.quantity_delta,
    quantityBefore: row.quantity_before ?? undefined,
    quantityAfter: row.quantity_after ?? undefined,
    reason: row.reason ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    scannedCode: row.scanned_code ?? undefined,
    createdBy: row.created_by ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export function mapPhoto(row: {
  id: string;
  owner_type: PhotoAttachment["ownerType"];
  owner_id: string;
  document_kind: PhotoAttachment["documentKind"];
  original_name: string;
  mime_type: PhotoAttachment["mimeType"];
  size: number;
  caption: string | null;
  created_at: Date | string;
  created_by: string | null;
}): PhotoAttachment {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    documentKind: row.document_kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    caption: row.caption ?? undefined,
    createdAt: isoRequired(row.created_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function mapPurchaseOrder(row: {
  id: string;
  purchase_order_number: string;
  generated_at: Date | string;
  created_at: Date | string | null;
}): PurchaseOrder {
  return {
    id: row.id,
    purchaseOrderNumber: row.purchase_order_number,
    generatedAt: isoRequired(row.generated_at),
    createdAt: iso(row.created_at),
  };
}

export function mapReceivingOrder(row: {
  id: string;
  po_number: string;
  received_at: Date | string;
  vendor: string;
  order_number: string;
  carrier_inbound: string;
  receiver_name: string;
  load_pallet_count: number;
  status: ReceivingOrder["status"];
  is_partialed: boolean;
  partialed_at: Date | string | null;
  partialed_by: string | null;
  reopened_at: Date | string | null;
  reopened_by: string | null;
  working_pallet_id: string | null;
  pallets: ReceivingOrder["pallets"];
  notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
}): ReceivingOrder {
  return {
    id: row.id,
    poNumber: row.po_number,
    receivedAt: isoRequired(row.received_at),
    vendor: row.vendor,
    orderNumber: row.order_number,
    carrierInbound: row.carrier_inbound,
    receiverName: row.receiver_name,
    loadPalletCount: row.load_pallet_count,
    status: row.status,
    isPartialed: row.is_partialed,
    partialedAt: iso(row.partialed_at),
    partialedBy: row.partialed_by ?? undefined,
    reopenedAt: iso(row.reopened_at),
    reopenedBy: row.reopened_by ?? undefined,
    workingPalletId: row.working_pallet_id,
    pallets: row.pallets ?? [],
    notes: row.notes ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function mapShippingOrder(row: {
  id: string;
  shipped_at: Date | string;
  customer: string;
  shipment_number: string;
  carrier_outbound: string;
  shipper_name: string;
  load_pallet_count: number;
  waiting_on_items: boolean;
  items_in_jeopardy: string[];
  status: ShippingOrder["status"];
  pallets: ShippingOrder["pallets"];
  notes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  created_by: string | null;
}): ShippingOrder {
  return {
    id: row.id,
    shippedAt: isoRequired(row.shipped_at),
    customer: row.customer,
    shipmentNumber: row.shipment_number,
    carrierOutbound: row.carrier_outbound,
    shipperName: row.shipper_name,
    loadPalletCount: row.load_pallet_count,
    waitingOnItems: row.waiting_on_items,
    itemsInJeopardy: row.items_in_jeopardy ?? [],
    status: row.status,
    pallets: row.pallets ?? [],
    notes: row.notes ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by ?? undefined,
  };
}

export function assembleSystem(parts: {
  rooms: Room[];
  locations: Location[];
  users: User[];
  inventoryItems: InventoryItem[];
  transactions: InventoryTransaction[];
  photos: PhotoAttachment[];
  purchaseOrders: PurchaseOrder[];
  receivingOrders: ReceivingOrder[];
  shippingOrders: ShippingOrder[];
}): InventorySystem {
  return {
    rooms: parts.rooms,
    locations: parts.locations,
    users: parts.users,
    inventoryItems: parts.inventoryItems,
    transactions: parts.transactions,
    photos: parts.photos,
    purchaseOrders: parts.purchaseOrders,
    receivingOrders: parts.receivingOrders,
    shippingOrders: parts.shippingOrders,
  };
}

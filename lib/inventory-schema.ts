import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
export const UuidSchema = z.string().uuid();
export const NonEmptyStringSchema = z.string().min(1);
export const PositiveIntegerSchema = z.number().int().min(0);
export const DateTimeSchema = z.string().datetime(); // ISO 8601

// ---------------------------------------------------------------------------
// CaseItem
// ---------------------------------------------------------------------------
export const CaseItemSchema = z.object({
  id: UuidSchema.optional(),
  upc: z.string(),
  sku: z.string(),
  batch: z.string().nullable().default(null),
  quantityInCase: z.number().int().min(1),
  description: z.string(),
  putawayLocationId: z.string().nullable().optional(),
});

export type CaseItem = z.infer<typeof CaseItemSchema>;

// ---------------------------------------------------------------------------
// Pallet
// ---------------------------------------------------------------------------
export const PalletSchema = z.object({
  id: UuidSchema,
  palletNumber: NonEmptyStringSchema,
  isPartial: z.boolean(),
  partialedBy: z.string().nullable().default(null),
  expectedSkuCount: PositiveIntegerSchema,
  actualSkuCount: PositiveIntegerSchema,
  expectedCaseCount: PositiveIntegerSchema,
  actualCaseCount: PositiveIntegerSchema,
  cases: z.array(CaseItemSchema),
});

export type Pallet = z.infer<typeof PalletSchema>;

// ---------------------------------------------------------------------------
// ReceivingOrder
// ---------------------------------------------------------------------------
export const ReceivingOrderStatusSchema = z.enum([
  "draft",
  "in-progress",
  "completed",
  "cancelled",
]);

export const ReceivingOrderSchema = z.object({
  id: UuidSchema,
  poNumber: z.string(),
  receivedAt: DateTimeSchema,
  vendor: NonEmptyStringSchema,
  orderNumber: NonEmptyStringSchema,
  carrierInbound: NonEmptyStringSchema,
  receiverName: NonEmptyStringSchema,
  loadPalletCount: z.number().int().min(0),
  status: ReceivingOrderStatusSchema.default("draft"),
  pallets: z.array(PalletSchema).default([]),
  notes: z.string().optional(),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});

export type ReceivingOrder = z.infer<typeof ReceivingOrderSchema>;
export type ReceivingOrderStatus = z.infer<typeof ReceivingOrderStatusSchema>;

// ---------------------------------------------------------------------------
// ShippingOrder
// ---------------------------------------------------------------------------
export const ShippingOrderStatusSchema = z.enum([
  "draft",
  "picking",
  "packed",
  "shipped",
  "cancelled",
]);

export const ShippingOrderSchema = z.object({
  id: UuidSchema,
  shippedAt: DateTimeSchema,
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: NonEmptyStringSchema,
  loadPalletCount: z.number().int().min(0),
  waitingOnItems: z.boolean().default(false),
  itemsInJeopardy: z.array(z.string()).default([]),
  status: ShippingOrderStatusSchema.default("draft"),
  pallets: z.array(PalletSchema).default([]),
  notes: z.string().optional(),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});

export type ShippingOrder = z.infer<typeof ShippingOrderSchema>;
export type ShippingOrderStatus = z.infer<typeof ShippingOrderStatusSchema>;

// ---------------------------------------------------------------------------
// InventoryItem
// ---------------------------------------------------------------------------
export const InventoryItemSchema = z.object({
  id: UuidSchema,
  sku: z.string(),
  upc: z.string().optional(),
  batch: z.string().nullable().default(null),
  locationId: z.string(),
  quantity: z.number().int().min(0),
  description: z.string().optional(),
  lastMovedAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
});

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

// ---------------------------------------------------------------------------
// Location & Room
// ---------------------------------------------------------------------------
export const LocationSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  roomId: z.string(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

export type Location = z.infer<typeof LocationSchema>;

export const RoomSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string().optional(),
});

export type Room = z.infer<typeof RoomSchema>;

// ---------------------------------------------------------------------------
// Top-level system document (optional – useful for full payloads)
// ---------------------------------------------------------------------------
export const InventorySystemSchema = z.object({
  receivingOrders: z.array(ReceivingOrderSchema).default([]),
  shippingOrders: z.array(ShippingOrderSchema).default([]),
  inventoryItems: z.array(InventoryItemSchema).default([]),
  locations: z.array(LocationSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
});

export type InventorySystem = z.infer<typeof InventorySystemSchema>;
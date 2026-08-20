import { z } from "zod";

/**
 * Canonical Zod models for the Saltbox inventory app.
 *
 * Field mapping from `backend/schema/schema.json`:
 * - PO_# → PurchaseOrder
 * - Order → ReceivingOrder
 * - Shipment_Contents.Pallet_Receiving / Current_Pallet_Working → Pallet[]
 * - Case_Item → CaseItem (including Is_Fiber_Item, Putaway_Room, Putaway_Location)
 * - Outbound_Shipped → ShippingOrder
 * - Rooms / Locations → Room / Location
 */

export const UuidSchema = z.uuid();
export const NonEmptyStringSchema = z.string().trim().min(1);
export const PositiveIntegerSchema = z.coerce.number().int().min(0);
export const DateTimeSchema = z.iso.datetime();

export const ConnectionTypeSchema = z.enum([
  "LC",
  "SC",
  "ST",
  "FC",
  "MPO",
  "MTP",
  "Other",
]);
export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;
export const CONNECTION_TYPES = ConnectionTypeSchema.options;
export const STRAND_COUNTS = [1, 2, 4, 6, 8, 12, 24, 48, 72, 96, 144] as const;

export const StrandCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(12),
  z.literal(24),
  z.literal(48),
  z.literal(72),
  z.literal(96),
  z.literal(144),
]);
export type StrandCount = z.infer<typeof StrandCountSchema>;

export const FiberItemSchema = z.object({
  isFiber: z.boolean(),
  connectionType: ConnectionTypeSchema.nullable().default(null),
  strandCount: z.coerce.number().int().positive().nullable().default(null),
  lengthMeters: z.coerce.number().min(0).nullable().default(null),
});
export type FiberItem = z.infer<typeof FiberItemSchema>;

export const CaseItemSchema = z.object({
  id: UuidSchema,
  upc: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  batch: z.string().trim().nullable().default(null),
  quantityInCase: z.coerce.number().int().min(1),
  description: z.string().trim().min(1),
  fiber: FiberItemSchema.nullable().default(null),
  putawayRoomId: UuidSchema.nullable().default(null),
  putawayLocationId: UuidSchema.nullable().default(null),
});
export type CaseItem = z.infer<typeof CaseItemSchema>;

export const CaseItemInputSchema = CaseItemSchema.omit({ id: true }).extend({
  id: UuidSchema.optional(),
  batch: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  fiber: FiberItemSchema.nullable().optional().default(null),
  putawayRoomId: UuidSchema.nullable().optional().default(null),
  putawayLocationId: UuidSchema.nullable().optional().default(null),
});
export type CaseItemInput = z.infer<typeof CaseItemInputSchema>;

export const PalletSchema = z.object({
  id: UuidSchema,
  palletNumber: NonEmptyStringSchema,
  isPartial: z.boolean().default(false),
  partialedBy: z.string().trim().nullable().default(null),
  expectedSkuCount: PositiveIntegerSchema.default(0),
  actualSkuCount: PositiveIntegerSchema.default(0),
  expectedCaseCount: PositiveIntegerSchema.default(0),
  actualCaseCount: PositiveIntegerSchema.default(0),
  cases: z.array(CaseItemSchema).default([]),
});
export type Pallet = z.infer<typeof PalletSchema>;

export const PalletInputSchema = z.object({
  palletNumber: NonEmptyStringSchema,
  isPartial: z.boolean().default(false),
  partialedBy: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  expectedSkuCount: PositiveIntegerSchema.default(0),
  expectedCaseCount: PositiveIntegerSchema.default(0),
});
export type PalletInput = z.infer<typeof PalletInputSchema>;

export const ReceivingOrderStatusSchema = z.enum([
  "draft",
  "in-progress",
  "completed",
  "cancelled",
]);
export type ReceivingOrderStatus = z.infer<typeof ReceivingOrderStatusSchema>;

export const PurchaseOrderSchema = z.object({
  id: UuidSchema,
  purchaseOrderNumber: NonEmptyStringSchema,
  generatedAt: DateTimeSchema,
  createdAt: DateTimeSchema.optional(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const ReceivingOrderSchema = z.object({
  id: UuidSchema,
  poNumber: NonEmptyStringSchema,
  receivedAt: DateTimeSchema,
  vendor: NonEmptyStringSchema,
  orderNumber: NonEmptyStringSchema,
  carrierInbound: NonEmptyStringSchema,
  receiverName: NonEmptyStringSchema,
  loadPalletCount: z.coerce.number().int().min(0),
  status: ReceivingOrderStatusSchema.default("draft"),
  workingPalletId: UuidSchema.nullable().default(null),
  pallets: z.array(PalletSchema).default([]),
  notes: z.string().optional(),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});
export type ReceivingOrder = z.infer<typeof ReceivingOrderSchema>;

export const CreateReceivingOrderInputSchema = z.object({
  poNumber: NonEmptyStringSchema,
  poGeneratedAt: DateTimeSchema.optional(),
  receivedAt: DateTimeSchema.optional(),
  vendor: NonEmptyStringSchema,
  orderNumber: NonEmptyStringSchema,
  carrierInbound: NonEmptyStringSchema,
  receiverName: NonEmptyStringSchema,
  loadPalletCount: z.coerce.number().int().min(0).default(0),
  notes: z.string().optional(),
  createdBy: z.string().optional(),
});
export type CreateReceivingOrderInput = z.infer<
  typeof CreateReceivingOrderInputSchema
>;

export const ShippingOrderStatusSchema = z.enum([
  "draft",
  "picking",
  "packed",
  "shipped",
  "cancelled",
]);
export type ShippingOrderStatus = z.infer<typeof ShippingOrderStatusSchema>;

export const ShippingPickSchema = z.object({
  inventoryItemId: UuidSchema,
  quantity: z.coerce.number().int().min(1),
});
export type ShippingPick = z.infer<typeof ShippingPickSchema>;

export const ShippingOrderSchema = z.object({
  id: UuidSchema,
  shippedAt: DateTimeSchema,
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: NonEmptyStringSchema,
  loadPalletCount: z.coerce.number().int().min(0).default(0),
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

export const CreateShippingOrderInputSchema = z.object({
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: NonEmptyStringSchema,
  notes: z.string().optional(),
  createdBy: z.string().optional(),
  picks: z.array(ShippingPickSchema).min(1),
});
export type CreateShippingOrderInput = z.infer<
  typeof CreateShippingOrderInputSchema
>;

export const InventoryItemSchema = z.object({
  id: UuidSchema,
  sku: z.string().trim().min(1),
  upc: z.string().optional(),
  batch: z.string().nullable().default(null),
  locationId: UuidSchema,
  quantity: z.coerce.number().int().min(0),
  description: z.string().optional(),
  lastMovedAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const InventoryTransactionTypeSchema = z.enum([
  "receiving",
  "shipping",
  "overage",
  "shortage",
  "damage",
]);
export type InventoryTransactionType = z.infer<
  typeof InventoryTransactionTypeSchema
>;

export const InventoryTransactionSchema = z.object({
  id: UuidSchema,
  type: InventoryTransactionTypeSchema,
  occurredAt: DateTimeSchema,
  sku: NonEmptyStringSchema,
  upc: z.string().optional(),
  batch: z.string().nullable().default(null),
  inventoryItemId: UuidSchema.nullable().default(null),
  locationId: UuidSchema.nullable().default(null),
  destinationLocationId: UuidSchema.nullable().default(null),
  quantityDelta: z.number().int(),
  quantityBefore: z.coerce.number().int().min(0).optional(),
  quantityAfter: z.coerce.number().int().min(0).optional(),
  reason: z.string().optional(),
  referenceType: z
    .enum(["receiving-order", "shipping-order", "adjustment"])
    .optional(),
  referenceId: UuidSchema.optional(),
  scannedCode: z.string().optional(),
  createdBy: z.string().optional(),
  notes: z.string().optional(),
});
export type InventoryTransaction = z.infer<typeof InventoryTransactionSchema>;

export const CreateAdjustmentInputSchema = z.object({
  type: z.enum(["overage", "shortage", "damage"]),
  quantity: z.coerce.number().int().min(1),
  reason: NonEmptyStringSchema,
  inventoryItemId: UuidSchema.optional(),
  sku: z.string().trim().optional(),
  upc: z.string().trim().optional(),
  batch: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  locationId: UuidSchema.optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  createdBy: z.string().optional(),
  scannedCode: z.string().optional(),
  moveDamagedToLocationId: UuidSchema.optional(),
});
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;

export const LocationSchema = z.object({
  id: UuidSchema,
  code: NonEmptyStringSchema,
  roomId: UuidSchema,
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type Location = z.infer<typeof LocationSchema>;

export const CreateLocationInputSchema = z.object({
  code: NonEmptyStringSchema,
  roomId: UuidSchema,
  description: z.string().optional(),
});
export type CreateLocationInput = z.infer<typeof CreateLocationInputSchema>;

export const RoomSchema = z.object({
  id: UuidSchema,
  name: NonEmptyStringSchema,
  description: z.string().optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const CreateRoomInputSchema = z.object({
  name: NonEmptyStringSchema,
  description: z.string().optional(),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInputSchema>;

export const UserRoleSchema = z.enum(["user", "associate", "manager"]);
export type UserRole = z.infer<typeof UserRoleSchema>;
export const USER_ROLES = UserRoleSchema.options;

export const UserSchema = z.object({
  id: UuidSchema,
  name: NonEmptyStringSchema,
  email: z.email().trim().toLowerCase(),
  passwordHash: NonEmptyStringSchema,
  role: UserRoleSchema,
  isActive: z.boolean().default(true),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const PublicUserSchema = UserSchema.omit({ passwordHash: true });
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const LoginInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
  from: z.string().optional(),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const CreateUserInputSchema = z.object({
  name: NonEmptyStringSchema,
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: UserRoleSchema,
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z.object({
  id: UuidSchema,
  name: NonEmptyStringSchema.optional(),
  email: z.email().trim().toLowerCase().optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .optional(),
  role: UserRoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export const InventorySystemSchema = z.object({
  purchaseOrders: z.array(PurchaseOrderSchema).default([]),
  receivingOrders: z.array(ReceivingOrderSchema).default([]),
  shippingOrders: z.array(ShippingOrderSchema).default([]),
  inventoryItems: z.array(InventoryItemSchema).default([]),
  locations: z.array(LocationSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
  transactions: z.array(InventoryTransactionSchema).default([]),
  users: z.array(UserSchema).default([]),
});
export type InventorySystem = z.infer<typeof InventorySystemSchema>;

export const PartialReceivingOrderSchema = ReceivingOrderSchema.partial();
export type PartialReceivingOrder = z.infer<typeof PartialReceivingOrderSchema>;

export type InventoryRow = InventoryItem & {
  locationCode: string;
  roomName: string;
};

export type InventoryTransactionRow = InventoryTransaction & {
  locationCode: string;
  roomName: string;
  destinationLocationCode: string | null;
};

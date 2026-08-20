import { z } from "zod";
import {
  DescriptionSchema,
  EmailSchema,
  LocationCodeSchema,
  LoginPasswordSchema,
  NonNegativeCountSchema,
  OptionalNotesSchema,
  PasswordSchema,
  PersonNameSchema,
  QuantitySchema,
  ReasonSchema,
  SafeTextSchema,
  SkuSchema,
  UpcSchema,
} from "@/lib/validation/fields";
import { LIMITS } from "@/lib/validation/limits";

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
export const NonEmptyStringSchema = SafeTextSchema;
export const PositiveIntegerSchema = NonNegativeCountSchema;
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
  upc: UpcSchema,
  sku: SkuSchema,
  batch: z.string().trim().nullable().default(null),
  quantityInCase: QuantitySchema,
  description: DescriptionSchema,
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
    .max(LIMITS.code)
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  fiber: FiberItemSchema.nullable().optional().default(null),
  putawayRoomId: UuidSchema.nullable().optional().default(null),
  putawayLocationId: UuidSchema.nullable().optional().default(null),
  confirmLargeInput: z.boolean().optional().default(false),
  confirmationQuantity: z.coerce.number().int().optional(),
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
  notes: OptionalNotesSchema,
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
  receiverName: PersonNameSchema,
  loadPalletCount: NonNegativeCountSchema.default(0),
  notes: OptionalNotesSchema,
  createdBy: z.string().optional(),
  confirmLargeInput: z.boolean().optional().default(false),
  confirmationQuantity: z.coerce.number().int().optional(),
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
  quantity: QuantitySchema,
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
  notes: OptionalNotesSchema,
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});
export type ShippingOrder = z.infer<typeof ShippingOrderSchema>;

export const CreateShippingOrderInputSchema = z.object({
  customer: NonEmptyStringSchema,
  shipmentNumber: NonEmptyStringSchema,
  carrierOutbound: NonEmptyStringSchema,
  shipperName: PersonNameSchema,
  notes: OptionalNotesSchema,
  createdBy: z.string().optional(),
  picks: z.array(ShippingPickSchema).min(1),
  confirmLargeInput: z.boolean().optional().default(false),
  confirmationQuantity: z.coerce.number().int().optional(),
});
export type CreateShippingOrderInput = z.infer<
  typeof CreateShippingOrderInputSchema
>;

export const InventoryItemSchema = z.object({
  id: UuidSchema,
  sku: SkuSchema,
  upc: UpcSchema.optional(),
  batch: z.string().nullable().default(null),
  locationId: UuidSchema,
  quantity: NonNegativeCountSchema,
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
  reason: OptionalNotesSchema,
  referenceType: z
    .enum(["receiving-order", "shipping-order", "adjustment"])
    .optional(),
  referenceId: UuidSchema.optional(),
  scannedCode: z.string().optional(),
  createdBy: z.string().optional(),
  notes: OptionalNotesSchema,
});
export type InventoryTransaction = z.infer<typeof InventoryTransactionSchema>;

export const CreateAdjustmentInputSchema = z.object({
  type: z.enum(["overage", "shortage", "damage"]),
  quantity: QuantitySchema,
  reason: ReasonSchema,
  inventoryItemId: UuidSchema.optional(),
  sku: SkuSchema.optional(),
  upc: UpcSchema.optional(),
  batch: z
    .string()
    .trim()
    .max(LIMITS.code)
    .nullable()
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value)),
  locationId: UuidSchema.optional(),
  description: z.string().optional(),
  notes: OptionalNotesSchema,
  createdBy: z.string().optional(),
  scannedCode: z.string().max(LIMITS.notes).optional(),
  moveDamagedToLocationId: UuidSchema.optional(),
  confirmLargeInput: z.boolean().optional().default(false),
  confirmationQuantity: z.coerce.number().int().optional(),
});
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;

export const LocationSchema = z.object({
  id: UuidSchema,
  code: LocationCodeSchema,
  roomId: UuidSchema,
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type Location = z.infer<typeof LocationSchema>;

export const CreateLocationInputSchema = z.object({
  code: LocationCodeSchema,
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
  name: PersonNameSchema,
  email: EmailSchema,
  passwordHash: z.string().min(1).max(512),
  role: UserRoleSchema,
  isActive: z.boolean().default(true),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  createdBy: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const PublicUserSchema = UserSchema.omit({ passwordHash: true });
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const LoginInputSchema = z
  .object({
    email: EmailSchema,
    password: LoginPasswordSchema,
    from: z.string().optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const CreateUserInputSchema = z
  .object({
    name: PersonNameSchema,
    email: EmailSchema,
    password: PasswordSchema,
    role: UserRoleSchema,
  })
  .strict();
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z
  .object({
    id: UuidSchema,
    name: PersonNameSchema.optional(),
    email: EmailSchema.optional(),
    password: PasswordSchema.optional(),
    role: UserRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
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

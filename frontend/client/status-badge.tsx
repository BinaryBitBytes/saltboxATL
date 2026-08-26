"use client";

import { Badge } from "@/components/ui/badge";
import type {
  InventoryTransactionType,
  ReceivingOrderStatus,
  ShippingOrderStatus,
} from "@/lib/inventory-schema";

const receivingVariant: Record<
  ReceivingOrderStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  draft: "outline",
  "in-progress": "secondary",
  received: "secondary",
  completed: "default",
  cancelled: "destructive",
};

const shippingVariant: Record<
  ShippingOrderStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  draft: "outline",
  picking: "secondary",
  packed: "secondary",
  shipped: "default",
  cancelled: "destructive",
};

export function ReceivingStatusBadge({
  status,
  isPartialed = false,
}: {
  status: ReceivingOrderStatus;
  isPartialed?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={receivingVariant[status]}>{status}</Badge>
      {isPartialed ? <Badge variant="outline">partialed</Badge> : null}
    </span>
  );
}

export function ShippingStatusBadge({
  status,
}: {
  status: ShippingOrderStatus;
}) {
  return <Badge variant={shippingVariant[status]}>{status}</Badge>;
}

const transactionVariant: Record<
  InventoryTransactionType,
  "outline" | "secondary" | "default" | "destructive"
> = {
  receiving: "secondary",
  putaway: "default",
  shipping: "outline",
  overage: "default",
  shortage: "destructive",
  damage: "destructive",
  import: "secondary",
};

export function TransactionTypeBadge({
  type,
}: {
  type: InventoryTransactionType;
}) {
  return <Badge variant={transactionVariant[type]}>{type}</Badge>;
}

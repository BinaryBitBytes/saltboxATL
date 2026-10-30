"use client";

import { T } from "@/frontend/client/language";
import { Badge } from "@/components/ui/badge";
import type {
  InventoryTransactionType,
  CustomerOrderStatus,
  PickRequestStatus,
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
  intake,
}: {
  status: ReceivingOrderStatus;
  isPartialed?: boolean;
  intake?: "dock" | "expected" | null;
}) {
  const expected = intake === "expected" && status === "draft";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={receivingVariant[status]}>
        {expected ? <T>Expected</T> : status}
      </Badge>
      {isPartialed ? <Badge variant="outline"><T>partialed</T></Badge> : null}
    </span>
  );
}

const customerOrderVariant: Record<
  CustomerOrderStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  picking: "secondary",
  fulfilled: "default",
  cancelled: "destructive",
};

const pickRequestVariant: Record<
  PickRequestStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  open: "secondary",
  completed: "default",
  cancelled: "destructive",
};

export function CustomerOrderStatusBadge({
  status,
}: {
  status: CustomerOrderStatus;
}) {
  return <Badge variant={customerOrderVariant[status]}>{status}</Badge>;
}

export function PickRequestStatusBadge({
  status,
}: {
  status: PickRequestStatus;
}) {
  return <Badge variant={pickRequestVariant[status]}>{status}</Badge>;
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
  move: "default",
  shipping: "outline",
  pick: "secondary",
  overage: "default",
  shortage: "destructive",
  damage: "destructive",
  import: "secondary",
  "site-transfer": "default",
  "transfer-outbound": "outline",
  "transfer-inbound": "secondary",
};

export function TransactionTypeBadge({ type }: { type: string }) {
  const variant =
    transactionVariant[type as InventoryTransactionType] ?? "outline";
  return <Badge variant={variant}>{type}</Badge>;
}

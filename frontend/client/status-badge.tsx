"use client";

import { Badge } from "@/components/ui/badge";
import type {
  ReceivingOrderStatus,
  ShippingOrderStatus,
} from "@/lib/inventory-schema";

const receivingVariant: Record<
  ReceivingOrderStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  draft: "outline",
  "in-progress": "secondary",
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
}: {
  status: ReceivingOrderStatus;
}) {
  return <Badge variant={receivingVariant[status]}>{status}</Badge>;
}

export function ShippingStatusBadge({
  status,
}: {
  status: ShippingOrderStatus;
}) {
  return <Badge variant={shippingVariant[status]}>{status}</Badge>;
}

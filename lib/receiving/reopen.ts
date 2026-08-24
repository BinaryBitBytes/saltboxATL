import type { CaseItem, ReceivingOrder } from "@/lib/inventory-schema";

export function remainingExpectedPallets(order: {
  loadPalletCount: number;
  pallets: unknown[];
}): number {
  return Math.max(0, order.loadPalletCount - order.pallets.length);
}

export function defaultReopenExpectedPalletCount(order: {
  loadPalletCount: number;
  pallets: unknown[];
}): number {
  return Math.max(order.loadPalletCount, order.pallets.length + 1);
}

export function isCasePutawayPosted(item: Pick<CaseItem, "putawayPostedAt">): boolean {
  return Boolean(item.putawayPostedAt);
}

export function casesPendingPutaway(order: Pick<ReceivingOrder, "pallets">): CaseItem[] {
  return order.pallets.flatMap((pallet) =>
    pallet.cases.filter((item) => !isCasePutawayPosted(item)),
  );
}

export function hasPostedPutaway(order: Pick<ReceivingOrder, "pallets">): boolean {
  return order.pallets.some((pallet) =>
    pallet.cases.some((item) => isCasePutawayPosted(item)),
  );
}

export function canReopenClosedReceiving(order: {
  status: ReceivingOrder["status"];
}): boolean {
  return order.status === "received" || order.status === "completed";
}

export function applyReopenAsPartial(
  order: ReceivingOrder,
  actorName: string,
  now: string,
  expectedPalletCount?: number,
): ReceivingOrder {
  if (!canReopenClosedReceiving(order)) {
    throw new Error(
      `Receiving order ${order.orderNumber} is ${order.status} and cannot be reopened.`,
    );
  }

  if (expectedPalletCount !== undefined) {
    if (expectedPalletCount <= order.pallets.length) {
      throw new Error(
        `Expected pallet count must be greater than the ${order.pallets.length} pallet${order.pallets.length === 1 ? "" : "s"} already received.`,
      );
    }
    order.loadPalletCount = expectedPalletCount;
  }

  if (order.pallets.length >= order.loadPalletCount) {
    throw new Error(
      "This order already has all expected pallets. Increase the expected pallet count to reopen for remaining freight.",
    );
  }

  if (order.status === "completed") {
    for (const pallet of order.pallets) {
      for (const item of pallet.cases) {
        if (!item.putawayPostedAt) {
          item.putawayPostedAt = now;
        }
      }
    }
  }

  order.status = "in-progress";
  order.isPartialed = true;
  order.partialedAt = now;
  order.partialedBy = actorName;
  order.reopenedAt = now;
  order.reopenedBy = actorName;
  order.workingPalletId = null;
  order.updatedAt = now;
  return order;
}

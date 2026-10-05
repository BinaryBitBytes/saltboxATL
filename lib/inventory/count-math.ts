import type {
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionType,
} from "@/lib/inventory-schema";

export type StockMath = {
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
};

export type CountDiscrepancy = {
  sku: string;
  inventoryItemId?: string;
  transactionId?: string;
  message: string;
};

export type InventoryCountMovements = {
  putaway: number;
  receiving: number;
  shipping: number;
  overage: number;
  shortage: number;
  damageWriteOff: number;
  damageMoved: number;
  damageNet: number;
  import: number;
};

export type InventoryCountReport = {
  onHand: number;
  movements: InventoryCountMovements;
  discrepancies: CountDiscrepancy[];
  balanced: boolean;
};

type CountItem = Pick<InventoryItem, "id" | "sku" | "quantity">;

type CountTransaction = Pick<
  InventoryTransaction,
  | "id"
  | "type"
  | "occurredAt"
  | "sku"
  | "inventoryItemId"
  | "quantityDelta"
  | "quantityBefore"
  | "quantityAfter"
  | "referenceId"
>;

const COUNTED_TYPES: InventoryTransactionType[] = [
  "receiving",
  "putaway",
  "shipping",
  "overage",
  "shortage",
  "damage",
  "import",
];

export function quantityAfterMatches(change: StockMath): boolean {
  return change.quantityAfter === change.quantityBefore + change.quantityDelta;
}

export function buildInventoryCountReport(input: {
  items: CountItem[];
  transactions: CountTransaction[];
}): InventoryCountReport {
  const discrepancies: CountDiscrepancy[] = [];
  const movements: InventoryCountMovements = {
    putaway: 0,
    receiving: 0,
    shipping: 0,
    overage: 0,
    shortage: 0,
    damageWriteOff: 0,
    damageMoved: 0,
    damageNet: 0,
    import: 0,
  };

  for (const transaction of input.transactions) {
    if (!COUNTED_TYPES.includes(transaction.type)) continue;
    if (
      transaction.type === "putaway" ||
      transaction.type === "receiving" ||
      transaction.type === "shipping" ||
      transaction.type === "overage" ||
      transaction.type === "shortage" ||
      transaction.type === "import"
    ) {
      movements[transaction.type] += transaction.quantityDelta;
    }
    checkTransactionMath(transaction, discrepancies);
  }

  const damage = summarizeDamage(input.transactions);
  movements.damageWriteOff = damage.writeOff;
  movements.damageMoved = damage.moved;
  movements.damageNet = damage.net;

  checkLedger(input.items, input.transactions, discrepancies);

  return {
    onHand: input.items.reduce((sum, item) => sum + item.quantity, 0),
    movements,
    discrepancies,
    balanced: discrepancies.length === 0,
  };
}

function checkTransactionMath(
  transaction: CountTransaction,
  discrepancies: CountDiscrepancy[],
): void {
  if (
    transaction.quantityBefore == null ||
    transaction.quantityAfter == null
  ) {
    discrepancies.push({
      sku: transaction.sku,
      inventoryItemId: transaction.inventoryItemId ?? undefined,
      transactionId: transaction.id,
      message: `${label(transaction.type)} for ${transaction.sku} is missing the before or after quantity.`,
    });
    return;
  }
  if (
    !quantityAfterMatches({
      quantityBefore: transaction.quantityBefore,
      quantityDelta: transaction.quantityDelta,
      quantityAfter: transaction.quantityAfter,
    })
  ) {
    discrepancies.push({
      sku: transaction.sku,
      inventoryItemId: transaction.inventoryItemId ?? undefined,
      transactionId: transaction.id,
      message: `${label(transaction.type)} for ${transaction.sku}: ${transaction.quantityBefore} + ${transaction.quantityDelta} does not equal ${transaction.quantityAfter}.`,
    });
  }
}

function checkLedger(
  items: CountItem[],
  transactions: CountTransaction[],
  discrepancies: CountDiscrepancy[],
): void {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const groups = new Map<string, Array<{ txn: CountTransaction; index: number }>>();
  transactions.forEach((txn, index) => {
    if (!txn.inventoryItemId) return;
    const group = groups.get(txn.inventoryItemId) ?? [];
    group.push({ txn, index });
    groups.set(txn.inventoryItemId, group);
  });

  for (const [itemId, group] of groups) {
    const ordered = [...group].sort((left, right) => {
      if (left.txn.occurredAt !== right.txn.occurredAt) {
        return left.txn.occurredAt < right.txn.occurredAt ? -1 : 1;
      }
      return right.index - left.index;
    });
    let previousAfter: number | undefined;
    for (const entry of ordered) {
      const before = entry.txn.quantityBefore;
      if (
        previousAfter != null &&
        before != null &&
        before !== previousAfter
      ) {
        discrepancies.push({
          sku: entry.txn.sku,
          inventoryItemId: itemId,
          transactionId: entry.txn.id,
          message: `${label(entry.txn.type)} for ${entry.txn.sku} starts at ${before}, but the previous transaction ended at ${previousAfter}.`,
        });
      }
      if (entry.txn.quantityAfter != null) previousAfter = entry.txn.quantityAfter;
    }

    const item = itemsById.get(itemId);
    const last = ordered[ordered.length - 1]?.txn;
    if (item && last?.quantityAfter != null && item.quantity !== last.quantityAfter) {
      discrepancies.push({
        sku: item.sku,
        inventoryItemId: itemId,
        transactionId: last.id,
        message: `${item.sku} on hand is ${item.quantity}, but the last transaction ended at ${last.quantityAfter}.`,
      });
    }
    if (!item && last?.quantityAfter != null && last.quantityAfter > 0) {
      discrepancies.push({
        sku: last.sku,
        inventoryItemId: itemId,
        transactionId: last.id,
        message: `${last.sku} has a transaction ending at ${last.quantityAfter}, but that inventory line is missing.`,
      });
    }
  }
}

function summarizeDamage(transactions: CountTransaction[]): {
  writeOff: number;
  moved: number;
  net: number;
} {
  const groups = new Map<string, CountTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.type !== "damage") continue;
    const key = transaction.referenceId ?? transaction.id;
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }

  let writeOff = 0;
  let moved = 0;
  let net = 0;
  for (const group of groups.values()) {
    const removed = group.reduce(
      (sum, transaction) =>
        sum + (transaction.quantityDelta < 0 ? -transaction.quantityDelta : 0),
      0,
    );
    const added = group.reduce(
      (sum, transaction) =>
        sum + (transaction.quantityDelta > 0 ? transaction.quantityDelta : 0),
      0,
    );
    moved += Math.min(removed, added);
    writeOff += Math.max(removed - added, 0);
    net += added - removed;
  }
  return { writeOff, moved, net };
}

function label(type: InventoryTransactionType): string {
  if (type === "import") return "Import";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

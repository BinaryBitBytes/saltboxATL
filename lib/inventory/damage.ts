import { ValidationError } from "@/lib/validation/errors";

/** Amber row treatment shared by the stock log, logbook, and dashboard. */
export const DAMAGE_LOG_HIGHLIGHT =
  "border-amber-500/80 bg-amber-100/90 dark:border-amber-400/60 dark:bg-amber-950/60";

export const DAMAGE_REPORT_ONLY_MESSAGE =
  "Report damaged inventory on the Damages tab.";

export const DAMAGE_TAB_ONLY_MESSAGE =
  "The Damages tab only reports damaged inventory.";

export const DAMAGE_ALREADY_HELD_MESSAGE =
  "Damaged units are already in that hold location. Write them off instead.";

export type DamageReportSource = "adjustment" | "damage-report";

export type DamageDisposition = "write-off" | "hold";

export type DamageTotals = {
  events: number;
  unitsDamaged: number;
  unitsWrittenOff: number;
  unitsHeld: number;
  onHandDelta: number;
};

export type DamageEvent = {
  id: string;
  occurredAt: string;
  sku: string;
  reason: string;
  actor: string;
  notes: string;
  disposition: DamageDisposition;
  unitsDamaged: number;
  unitsWrittenOff: number;
  unitsHeld: number;
  onHandDelta: number;
  sourceLocationId: string | null;
  holdLocationId: string | null;
};

export type DamageReport = {
  events: DamageEvent[];
  totals: DamageTotals;
};

export type DamageTransactionLine = {
  id: string;
  type: string;
  occurredAt: string;
  sku: string;
  quantityDelta: number;
  quantityBefore?: number;
  quantityAfter?: number;
  reason?: string | null;
  notes?: string | null;
  createdBy?: string;
  referenceId?: string;
  locationId?: string | null;
  destinationLocationId?: string | null;
};

export type DamageQuantityChange = {
  quantityBefore?: number;
  quantityAfter?: number;
  quantityDelta: number;
};

const EMPTY_TOTALS: DamageTotals = {
  events: 0,
  unitsDamaged: 0,
  unitsWrittenOff: 0,
  unitsHeld: 0,
  onHandDelta: 0,
};

export function isDamageTransaction(type: string): boolean {
  return type === "damage";
}

export function damageLogHighlight(type: string): string | undefined {
  return isDamageTransaction(type) ? DAMAGE_LOG_HIGHLIGHT : undefined;
}

/**
 * General adjustments stay overage and shortage. Damage is posted only from
 * the Damages tab, which is also the damage report.
 */
export function assertDamageReportedOnTab(
  type: string,
  source: DamageReportSource,
): void {
  if (source === "damage-report" && type !== "damage") {
    throw new ValidationError(DAMAGE_TAB_ONLY_MESSAGE);
  }
  if (source !== "damage-report" && type === "damage") {
    throw new ValidationError(DAMAGE_REPORT_ONLY_MESSAGE);
  }
}

/** A hold move into the bin the stock already occupies is a write-off. */
export function resolveDamageHoldLocation(
  sourceLocationId: string,
  holdLocationId: string | undefined,
): string | undefined {
  if (!holdLocationId) return undefined;
  if (holdLocationId === sourceLocationId) {
    throw new ValidationError(DAMAGE_ALREADY_HELD_MESSAGE);
  }
  return holdLocationId;
}

export function damageChangeBalances(change: DamageQuantityChange): boolean {
  if (
    change.quantityBefore === undefined ||
    change.quantityAfter === undefined
  ) {
    return false;
  }
  return change.quantityAfter === change.quantityBefore + change.quantityDelta;
}

export function assertDamageChangesBalance(
  changes: readonly DamageQuantityChange[],
): void {
  for (const change of changes) {
    if (!damageChangeBalances(change)) {
      throw new ValidationError("Damage quantity does not balance.");
    }
  }
}

export function damageEventFromLines(
  lines: readonly DamageTransactionLine[],
): DamageEvent {
  const outbound = lines.filter((line) => line.quantityDelta < 0);
  const inbound = lines.filter((line) => line.quantityDelta > 0);
  const unitsDamaged = outbound.reduce(
    (sum, line) => sum + Math.abs(line.quantityDelta),
    0,
  );
  const unitsHeld = inbound.reduce((sum, line) => sum + line.quantityDelta, 0);
  const onHandDelta = lines.reduce((sum, line) => sum + line.quantityDelta, 0);
  const first = outbound[0] ?? lines[0];
  const hold = inbound[0];
  return {
    id: first?.referenceId ?? first?.id ?? "",
    occurredAt: first?.occurredAt ?? "",
    sku: first?.sku ?? "",
    reason: first?.reason ?? "",
    actor: first?.createdBy ?? "",
    notes: first?.notes ?? "",
    disposition: unitsHeld > 0 ? "hold" : "write-off",
    unitsDamaged,
    unitsWrittenOff: Math.max(0, unitsDamaged - unitsHeld),
    unitsHeld,
    onHandDelta,
    sourceLocationId: (outbound[0] ?? first)?.locationId ?? null,
    holdLocationId: hold?.locationId ?? null,
  };
}

export function damageTotals(events: readonly DamageEvent[]): DamageTotals {
  return events.reduce(
    (totals, event) => ({
      events: totals.events + 1,
      unitsDamaged: totals.unitsDamaged + event.unitsDamaged,
      unitsWrittenOff: totals.unitsWrittenOff + event.unitsWrittenOff,
      unitsHeld: totals.unitsHeld + event.unitsHeld,
      onHandDelta: totals.onHandDelta + event.onHandDelta,
    }),
    { ...EMPTY_TOTALS },
  );
}

/**
 * One damage posting can write two stock rows when units move into a hold
 * bin. Those rows share a reference and count once: units damaged are the
 * quantity that left the source, and on-hand changes only when nothing was
 * received into hold.
 */
export function buildDamageReport(
  transactions: readonly DamageTransactionLine[],
): DamageReport {
  const groups = new Map<string, DamageTransactionLine[]>();
  for (const entry of transactions) {
    if (!isDamageTransaction(entry.type)) continue;
    const key = entry.referenceId ?? entry.id;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const events = [...groups.values()]
    .map((group) => damageEventFromLines(group))
    .sort((a, b) =>
      a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
    );

  return { events, totals: damageTotals(events) };
}

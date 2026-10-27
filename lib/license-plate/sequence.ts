/**
 * 8-digit license plates, 00000000 through 99999999.
 *
 * Ordinals are consecutive. The plate value is that ordinal after the
 * consecutive list is reordered with a zigzag merge: the first half
 * interleaved with the reversed second half
 * (0, 99999999, 1, 99999998, ...).
 *
 * Active users each hold a buffer of upcoming plates. The buffer depth
 * equals the number of users currently entering inventory, and those
 * plates are dealt boustrophedon (left to right, then right to left)
 * so two users never reserve the same number.
 */

export const LICENSE_PLATE_MIN = 0;
export const LICENSE_PLATE_MAX = 99_999_999;
export const LICENSE_PLATE_SPAN = LICENSE_PLATE_MAX + 1;
/** Holds unissued plates returned when a user stops entering inventory. */
export const LICENSE_PLATE_POOL_USER = "*reclaimed*";
const USER_ID_MAX = 200;

export type PlateReservation = {
  userId: string;
  plates: number[];
};

export type LicensePlateLedger = {
  nextOrdinal: number;
  activeUsers: string[];
  reservations: PlateReservation[];
};

export type IssuedLicensePlate = {
  value: number;
  number: string;
  code: string;
};

export function emptyLedger(): LicensePlateLedger {
  return { nextOrdinal: 0, activeUsers: [], reservations: [] };
}

export function normalizeUserId(userId: string | null | undefined): string {
  const trimmed = userId?.trim() ?? "";
  if (!trimmed || trimmed === LICENSE_PLATE_POOL_USER) return "system";
  return trimmed.slice(0, USER_ID_MAX);
}

export function normalizeLedger(
  ledger?: Partial<LicensePlateLedger> | null,
): LicensePlateLedger {
  return {
    nextOrdinal:
      typeof ledger?.nextOrdinal === "number" &&
      Number.isInteger(ledger.nextOrdinal) &&
      ledger.nextOrdinal >= 0
        ? ledger.nextOrdinal
        : 0,
    activeUsers: [...(ledger?.activeUsers ?? [])],
    reservations: (ledger?.reservations ?? []).map((entry) => ({
      userId: entry.userId,
      plates: [...entry.plates],
    })),
  };
}

/** Reorder a list L0..Ln into L0, Ln, L1, Ln-1, L2, Ln-2, ... */
export function zigzagMerge<T>(values: readonly T[]): T[] {
  const midpoint = Math.ceil(values.length / 2);
  const front = values.slice(0, midpoint);
  const back = values.slice(midpoint).reverse();
  const merged: T[] = [];
  for (let index = 0; index < front.length; index += 1) {
    merged.push(front[index] as T);
    if (index < back.length) merged.push(back[index] as T);
  }
  return merged;
}

export function plateValueAtOrdinal(
  ordinal: number,
  max: number = LICENSE_PLATE_MAX,
): number {
  const span = max + 1;
  if (!Number.isInteger(max) || max < 1 || span % 2 !== 0) {
    throw new Error("License plate range must cover an even count of numbers.");
  }
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > max) {
    throw new Error("License plate sequence is exhausted.");
  }
  const half = Math.floor(ordinal / 2);
  return ordinal % 2 === 0 ? half : max - half;
}

export function ordinalForPlateValue(
  value: number,
  max: number = LICENSE_PLATE_MAX,
): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error("License plate numbers run from 00000000 through 99999999.");
  }
  const midpoint = (max + 1) / 2;
  if (value < midpoint) return value * 2;
  return (max - value) * 2 + 1;
}

export function formatPlateNumber(value: number): string {
  if (!Number.isInteger(value) || value < LICENSE_PLATE_MIN || value > LICENSE_PLATE_MAX) {
    throw new Error("License plate numbers run from 00000000 through 99999999.");
  }
  return String(value).padStart(8, "0");
}

export function formatPlateCode(value: number): string {
  return `LP${formatPlateNumber(value)}`;
}

/** Accepts `00000042` or `LP00000042`. */
export function parsePlateNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  const prefixed = /^LP(\d{8})$/i.exec(trimmed);
  if (prefixed?.[1]) return prefixed[1];
  if (/^\d{8}$/.test(trimmed)) return trimmed;
  return null;
}

export function bufferDepth(activeUserCount: number): number {
  if (!Number.isInteger(activeUserCount) || activeUserCount < 1) return 1;
  return activeUserCount;
}

function reservationSlot(ledger: LicensePlateLedger, userId: string): PlateReservation {
  let slot = ledger.reservations.find((entry) => entry.userId === userId);
  if (!slot) {
    slot = { userId, plates: [] };
    ledger.reservations.push(slot);
  }
  return slot;
}

function takePlateValue(ledger: LicensePlateLedger, reclaimed: number[]): number {
  const reused = reclaimed.shift();
  if (reused != null) return reused;
  const ordinal = ledger.nextOrdinal;
  ledger.nextOrdinal += 1;
  return plateValueAtOrdinal(ordinal);
}

/**
 * Top every active user up to `bufferDepth(activeUsers)` reserved plates.
 * Plates left behind by users who are no longer active go back into the
 * pool before any new ordinal is taken.
 */
export function fillBuffers(
  ledger: LicensePlateLedger,
  activeUserIds: readonly string[],
): void {
  const holders = [
    ...new Set(activeUserIds.map((userId) => normalizeUserId(userId))),
  ]
    .filter((userId) => userId !== LICENSE_PLATE_POOL_USER)
    .sort();
  const users = holders.length > 0 ? holders : ["system"];
  ledger.activeUsers = users;
  const depth = bufferDepth(users.length);
  const stillActive = new Set(users);
  const reclaimed: number[] = [];
  const kept: PlateReservation[] = [];
  for (const entry of ledger.reservations) {
    if (entry.userId === LICENSE_PLATE_POOL_USER || !stillActive.has(entry.userId)) {
      reclaimed.push(...entry.plates);
      continue;
    }
    kept.push({ userId: entry.userId, plates: entry.plates });
  }
  ledger.reservations = kept;

  const held = (userId: string) => reservationSlot(ledger, userId).plates.length;
  const deficit = () =>
    users.reduce((sum, userId) => sum + Math.max(0, depth - held(userId)), 0);

  let pass = 0;
  let guard = deficit() + users.length;
  while (deficit() > 0 && guard > 0) {
    guard -= 1;
    const order = pass % 2 === 0 ? users : [...users].reverse();
    let assigned = false;
    for (const userId of order) {
      const slot = reservationSlot(ledger, userId);
      if (slot.plates.length >= depth) continue;
      slot.plates.push(takePlateValue(ledger, reclaimed));
      assigned = true;
    }
    if (!assigned) break;
    pass += 1;
  }

  if (deficit() > 0) {
    throw new Error("License plate buffer could not be filled.");
  }
  if (reclaimed.length > 0) {
    ledger.reservations.push({ userId: LICENSE_PLATE_POOL_USER, plates: reclaimed });
  }
  ledger.reservations.sort((left, right) => left.userId.localeCompare(right.userId));
}

export function issuePlate(
  ledger: LicensePlateLedger,
  userId: string,
  activeUserIds?: readonly string[],
): number {
  const id = normalizeUserId(userId);
  const base = (activeUserIds ?? ledger.activeUsers).map((entry) => normalizeUserId(entry));
  const active = base.includes(id) ? base : [...base, id];
  fillBuffers(ledger, active);
  const slot = reservationSlot(ledger, id);
  const plate = slot.plates.shift();
  if (plate == null) {
    throw new Error("License plate buffer was empty.");
  }
  fillBuffers(ledger, ledger.activeUsers);
  return plate;
}

export function presentPlate(value: number): IssuedLicensePlate {
  return {
    value,
    number: formatPlateNumber(value),
    code: formatPlateCode(value),
  };
}

export type LicensePlateGate = {
  snapshot: () => LicensePlateLedger;
  prepare: (activeUserIds: readonly string[]) => Promise<LicensePlateLedger>;
  issue: (userId: string, activeUserIds?: readonly string[]) => Promise<IssuedLicensePlate>;
};

/**
 * Serializes overlapping issuers. The optional hook runs while the gate
 * is still held, so a second caller cannot read the cursor until the
 * first assignment has finished.
 */
export function createLicensePlateGate(
  initial?: Partial<LicensePlateLedger> | null,
  options?: { afterReserve?: () => Promise<void> | void },
): LicensePlateGate {
  const ledger = normalizeLedger(initial);
  let tail: Promise<void> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T> | T): Promise<T> {
    const run = tail.then(work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    snapshot() {
      return normalizeLedger(ledger);
    },
    prepare(activeUserIds) {
      return exclusive(() => {
        fillBuffers(ledger, activeUserIds);
        return normalizeLedger(ledger);
      });
    },
    issue(userId, activeUserIds) {
      return exclusive(async () => {
        const value = issuePlate(ledger, userId, activeUserIds);
        await options?.afterReserve?.();
        return presentPlate(value);
      });
    },
  };
}

/**
 * Spoken site codenames and the fixed bin address:
 * {CODENAME}-{BBB}-{Z}{AA}-{BB}-{SLOT}
 */

export class NomenclatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NomenclatureError";
  }
}

export const PHONETIC_CODENAMES = [
  "ALPHA",
  "BETA",
  "CHARLIE",
  "DELTA",
  "ECHO",
  "FOXTROT",
  "GOLF",
  "HOTEL",
  "INDIA",
  "JULIET",
  "KILO",
  "LIMA",
  "MIKE",
  "NOVEMBER",
  "OSCAR",
  "PAPA",
  "QUEBEC",
  "ROMEO",
  "SIERRA",
  "TANGO",
  "UNIFORM",
  "VICTOR",
  "WHISKEY",
  "XRAY",
  "YANKEE",
  "ZULU",
] as const;

export type PhoneticCodename = (typeof PHONETIC_CODENAMES)[number];

export const ZONE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export const PICK_HEIGHTS = ["A", "B", "C", "D"] as const;
export type PickHeight = (typeof PICK_HEIGHTS)[number];

export const OVERHEAD_SIDES = ["A", "B"] as const;
export type OverheadSide = (typeof OVERHEAD_SIDES)[number];

export const VELOCITIES = ["fast", "medium", "slow"] as const;
export type Velocity = (typeof VELOCITIES)[number];

export const CUBE_SIZES = ["small", "medium", "large", "pallet"] as const;
export type CubeSize = (typeof CUBE_SIZES)[number];

export const TRAILER_STATUSES = ["expected", "arrived", "departed"] as const;
export type TrailerStatus = (typeof TRAILER_STATUSES)[number];

const PICK_HEIGHT_NAMES: Record<PickHeight, string> = {
  A: "low",
  B: "mid",
  C: "high",
  D: "highest",
};

export type PickSlot = {
  kind: "pick";
  height: PickHeight;
  position: number;
};

export type OverheadSlot = {
  kind: "overhead";
  height: number;
  side: OverheadSide;
};

export type SlotAddress = PickSlot | OverheadSlot;

export type BinAddress = {
  codename: PhoneticCodename;
  building: number;
  zone: string;
  aisle: number;
  bay: number;
  slot: SlotAddress;
};

export type BinAddressInput = {
  codename: string;
  building: number;
  zone: string;
  aisle: number;
  bay: number;
  slot:
    | { kind: "pick"; height: string; position: number }
    | { kind: "overhead"; height: string | number; side: string };
};

const BIN_CODE =
  /^([A-Z]+)-(\d{3})-([A-Z])(\d{2})-(\d{2})-([A-D]0[1-9]|0[4-9][AB])$/;

const CODE_LIMIT = 40;

export function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function isPhoneticCodename(value: string): value is PhoneticCodename {
  return (PHONETIC_CODENAMES as readonly string[]).includes(value);
}

export function unusedCodenames(used: readonly string[]): PhoneticCodename[] {
  const taken = new Set(used.map((value) => value.trim().toUpperCase()));
  return PHONETIC_CODENAMES.filter((name) => !taken.has(name));
}

export function formatSlot(
  slot: BinAddressInput["slot"],
): string {
  if (slot.kind === "pick") {
    const height = slot.height.trim().toUpperCase();
    if (!PICK_HEIGHTS.includes(height as PickHeight)) {
      throw new NomenclatureError(
        "Pick height is A low, B mid, C high, or D highest.",
      );
    }
    if (!Number.isInteger(slot.position) || slot.position < 1 || slot.position > 9) {
      throw new NomenclatureError("Pick positions run from 01 through 09.");
    }
    return `${height}${padNumber(slot.position, 2)}`;
  }

  const height = overheadHeight(slot.height);
  if (height == null) {
    throw new NomenclatureError("Overhead heights run from 04 through 09.");
  }
  const side = slot.side.trim().toUpperCase();
  if (side !== "A" && side !== "B") {
    throw new NomenclatureError("Overhead side is A for left or B for right.");
  }
  return `${padNumber(height, 2)}${side}`;
}

export function formatBinCode(input: BinAddressInput): string {
  const codename = input.codename.trim().toUpperCase();
  if (!isPhoneticCodename(codename)) {
    throw new NomenclatureError(
      "Codename must be a phonetic site name such as ALPHA or BETA.",
    );
  }
  if (!Number.isInteger(input.building) || input.building < 1 || input.building > 100) {
    throw new NomenclatureError("Building numbers run from 001 through 100.");
  }
  const zone = input.zone.trim().toUpperCase();
  if (!/^[A-Z]$/.test(zone)) {
    throw new NomenclatureError("Zone must be a single letter.");
  }
  if (!Number.isInteger(input.aisle) || input.aisle < 1 || input.aisle > 99) {
    throw new NomenclatureError("Aisle numbers run from 01 through 99.");
  }
  if (!Number.isInteger(input.bay) || input.bay < 1 || input.bay > 99) {
    throw new NomenclatureError("Bay numbers run from 01 through 99.");
  }
  const slot = formatSlot(input.slot);
  const code = `${codename}-${padNumber(input.building, 3)}-${zone}${padNumber(input.aisle, 2)}-${padNumber(input.bay, 2)}-${slot}`;
  if (code.length > CODE_LIMIT) {
    throw new NomenclatureError("Location code exceeds 40 characters.");
  }
  return code;
}

export function parseBinCode(value: string): BinAddress | null {
  const match = BIN_CODE.exec(value.trim().toUpperCase());
  if (!match) return null;
  const codename = match[1] ?? "";
  if (!isPhoneticCodename(codename)) return null;
  const building = Number(match[2]);
  const aisle = Number(match[4]);
  const bay = Number(match[5]);
  if (building < 1 || building > 100 || aisle < 1 || aisle > 99 || bay < 1 || bay > 99) {
    return null;
  }
  const slot = parseSlot(match[6] ?? "");
  if (!slot) return null;
  return {
    codename,
    building,
    zone: match[3] ?? "",
    aisle,
    bay,
    slot,
  };
}

export function describeSlot(slot: SlotAddress): string {
  if (slot.kind === "pick") {
    return `Pick path ${PICK_HEIGHT_NAMES[slot.height]}, position ${padNumber(slot.position, 2)}`;
  }
  const side = slot.side === "A" ? "left" : "right";
  return `Overhead height ${padNumber(slot.height, 2)}, ${side}`;
}

export function compareBinAddresses(left: BinAddress, right: BinAddress): number {
  return (
    left.codename.localeCompare(right.codename) ||
    left.building - right.building ||
    left.zone.localeCompare(right.zone) ||
    left.aisle - right.aisle ||
    left.bay - right.bay ||
    slotRank(left.slot) - slotRank(right.slot)
  );
}

export function compareBinCodes(left: string, right: string): number {
  const a = parseBinCode(left);
  const b = parseBinCode(right);
  if (a && b) return compareBinAddresses(a, b);
  if (a) return -1;
  if (b) return 1;
  return left.localeCompare(right);
}

export function formatTrailerCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999_999) {
    throw new NomenclatureError("Trailer numbers run from TN000001 through TN999999.");
  }
  return `TN${padNumber(sequence, 6)}`;
}

export function parseTrailerCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^TN\d{6}$/.test(code) || code === "TN000000") return null;
  return code;
}

export function formatLicensePlate(token: string): string {
  return formatHandlingCode("LP", token, "License plate needs 8 letters or numbers after LP.");
}

export function parseLicensePlate(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^LP[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function formatContainerCode(token: string): string {
  return formatHandlingCode("CN", token, "Container needs 8 letters or numbers after CN.");
}

export function parseContainerCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^CN[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function slotFitsBayCube(input: {
  bayCubeBudgetCubicInches: number;
  committedCubicInches: number;
  incomingCubicInches: number;
}): boolean {
  const budget = input.bayCubeBudgetCubicInches;
  const used = input.committedCubicInches + input.incomingCubicInches;
  if (!Number.isFinite(budget) || budget <= 0) return false;
  if (!Number.isFinite(used) || used < 0) return false;
  return Math.round(used * 1000) / 1000 <= Math.round(budget * 1000) / 1000 + 0.001;
}

function formatHandlingCode(prefix: "LP" | "CN", token: string, error: string): string {
  const trimmed = token.trim().toUpperCase();
  const exact = new RegExp(`^${prefix}[A-Z0-9]{8}$`);
  if (exact.test(trimmed)) return trimmed;
  const body = trimmed.replace(/[^A-Z0-9]/g, "");
  if (body.length < 8) throw new NomenclatureError(error);
  return `${prefix}${body.slice(0, 8)}`;
}

function overheadHeight(value: string | number): number | null {
  const text = String(value).trim().padStart(2, "0");
  if (!/^0[4-9]$/.test(text)) return null;
  return Number(text);
}

function parseSlot(slot: string): SlotAddress | null {
  const pick = /^([A-D])(0[1-9])$/.exec(slot);
  if (pick) {
    return {
      kind: "pick",
      height: pick[1] as PickHeight,
      position: Number(pick[2]),
    };
  }
  const overhead = /^(0[4-9])([AB])$/.exec(slot);
  if (overhead) {
    return {
      kind: "overhead",
      height: Number(overhead[1]),
      side: overhead[2] as OverheadSide,
    };
  }
  return null;
}

function slotRank(slot: SlotAddress): number {
  if (slot.kind === "pick") {
    return (slot.height.charCodeAt(0) - 65) * 10 + slot.position;
  }
  return 100 + slot.height * 2 + (slot.side === "A" ? 0 : 1);
}

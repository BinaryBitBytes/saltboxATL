import { parsePlateNumber } from "@/lib/license-plate/sequence";
import {
  formatSlot,
  parseBinCode,
  parseContainerCode,
  parseLicensePlate,
  parseTrailerCode,
  type BinAddress,
} from "@/lib/locations/nomenclature";

export type ScanPayload = {
  raw: string;
  sku?: string;
  upc?: string;
  batch?: string;
  locationCode?: string;
  trailerCode?: string;
  licensePlateCode?: string;
  licensePlateNumber?: string;
  containerCode?: string;
};

export function encodeScanPayload(input: {
  sku: string;
  upc?: string;
  batch?: string | null;
  licensePlateNumber?: string | null;
}): string {
  const licensePlate = parsePlateNumber(input.licensePlateNumber);
  return JSON.stringify({
    v: 1,
    type: "item",
    sku: input.sku,
    upc: input.upc || undefined,
    batch: input.batch || undefined,
    licensePlate: licensePlate || undefined,
  });
}

export function encodeLocationPayload(input: {
  code: string;
  room?: string | null;
  bin?: BinAddress | null;
}): string {
  const bin = input.bin ?? undefined;
  return JSON.stringify({
    v: bin ? 2 : 1,
    type: "location",
    code: input.code,
    room: input.room || undefined,
    ...(bin
      ? {
          codename: bin.codename,
          building: bin.building,
          zone: bin.zone,
          aisle: bin.aisle,
          bay: bin.bay,
          slot: formatSlot(bin.slot),
        }
      : {}),
  });
}

export function encodeHandlingPayload(input: {
  kind: "trailer" | "license-plate" | "container";
  code: string;
}): string {
  return JSON.stringify({
    v: 1,
    type: input.kind,
    code: input.code,
  });
}

function emptyToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseScanCode(rawInput: string): ScanPayload {
  const raw = rawInput.trim();
  if (!raw) return { raw };

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.type === "location") {
        return {
          raw,
          locationCode: emptyToUndefined(parsed.code) ?? emptyToUndefined(parsed.locationCode),
        };
      }
      if (parsed.type === "trailer") {
        const trailerCode = parseTrailerCode(String(parsed.code ?? ""));
        return trailerCode ? { raw, trailerCode } : { raw };
      }
      if (parsed.type === "license-plate") {
        const licensePlateCode = parseLicensePlate(String(parsed.code ?? ""));
        const licensePlateNumber = parsePlateNumber(licensePlateCode) ?? undefined;
        return licensePlateCode
          ? { raw, licensePlateCode, licensePlateNumber }
          : { raw };
      }
      if (parsed.type === "container") {
        const containerCode = parseContainerCode(String(parsed.code ?? ""));
        return containerCode ? { raw, containerCode } : { raw };
      }
      const licensePlateNumber =
        parsePlateNumber(emptyToUndefined(parsed.licensePlate)) ??
        parsePlateNumber(emptyToUndefined(parsed.licensePlateNumber)) ??
        undefined;
      return {
        raw,
        sku: emptyToUndefined(parsed.sku),
        upc: emptyToUndefined(parsed.upc),
        batch: emptyToUndefined(parsed.batch),
        locationCode: emptyToUndefined(parsed.locationCode),
        licensePlateNumber,
        licensePlateCode: licensePlateNumber ? `LP${licensePlateNumber}` : undefined,
      };
    } catch {
      return { raw };
    }
  }

  if (raw.startsWith("saltbox://") || /^https?:\/\//i.test(raw)) {
    try {
      const normalized = raw
        .replace(/^saltbox:\/\/item/i, "https://saltbox.local/item")
        .replace(/^saltbox:\/\/location/i, "https://saltbox.local/location")
        .replace(/^saltbox:\/\/trailer/i, "https://saltbox.local/trailer")
        .replace(/^saltbox:\/\/license-plate/i, "https://saltbox.local/license-plate")
        .replace(/^saltbox:\/\/container/i, "https://saltbox.local/container");
      const url = new URL(normalized);
      const codeParam =
        emptyToUndefined(url.searchParams.get("code")) ??
        emptyToUndefined(url.searchParams.get("location"));
      if (url.pathname.includes("license-plate")) {
        const licensePlateCode = codeParam ? parseLicensePlate(codeParam) : null;
        const licensePlateNumber = parsePlateNumber(licensePlateCode) ?? undefined;
        return licensePlateCode
          ? { raw, licensePlateCode, licensePlateNumber }
          : { raw };
      }
      if (url.pathname.includes("container")) {
        const containerCode = codeParam ? parseContainerCode(codeParam) : null;
        return containerCode ? { raw, containerCode } : { raw };
      }
      if (url.pathname.includes("trailer")) {
        const trailerCode = codeParam ? parseTrailerCode(codeParam) : null;
        return trailerCode ? { raw, trailerCode } : { raw };
      }
      if (url.pathname.includes("location")) {
        return {
          raw,
          locationCode: codeParam,
        };
      }
      return {
        raw,
        sku: emptyToUndefined(url.searchParams.get("sku")),
        upc: emptyToUndefined(url.searchParams.get("upc")),
        batch: emptyToUndefined(url.searchParams.get("batch")),
      };
    } catch {
      return { raw };
    }
  }

  const trailerCode = parseTrailerCode(raw);
  if (trailerCode) return { raw, trailerCode };
  const licensePlateCode = parseLicensePlate(raw);
  if (licensePlateCode) {
    const licensePlateNumber = parsePlateNumber(licensePlateCode) ?? undefined;
    return { raw, licensePlateCode, licensePlateNumber };
  }
  const containerCode = parseContainerCode(raw);
  if (containerCode) return { raw, containerCode };
  const bin = parseBinCode(raw);
  if (bin) return { raw, locationCode: raw.trim().toUpperCase() };

  if (/^\d{8}$/.test(raw)) {
    return { raw, licensePlateNumber: raw, licensePlateCode: `LP${raw}` };
  }

  if (/^\d{9,14}$/.test(raw)) {
    return { raw, upc: raw };
  }

  return { raw, sku: raw };
}

export function matchesScan(
  item: {
    sku: string;
    upc?: string;
    batch?: string | null;
    locationCode?: string;
    licensePlateCode?: string | null;
    licensePlateNumber?: string | null;
    containerCode?: string | null;
    trailerCode?: string | null;
  },
  parsed: ScanPayload,
): boolean {
  if (
    parsed.licensePlateNumber &&
    item.licensePlateNumber &&
    item.licensePlateNumber === parsed.licensePlateNumber
  ) {
    return true;
  }
  if (
    parsed.licensePlateCode &&
    item.licensePlateCode &&
    item.licensePlateCode.toLowerCase() === parsed.licensePlateCode.toLowerCase()
  ) {
    return true;
  }
  if (
    parsed.containerCode &&
    item.containerCode &&
    item.containerCode.toLowerCase() === parsed.containerCode.toLowerCase()
  ) {
    return true;
  }
  if (
    parsed.trailerCode &&
    item.trailerCode &&
    item.trailerCode.toLowerCase() === parsed.trailerCode.toLowerCase()
  ) {
    return true;
  }

  const raw = parsed.raw.toLowerCase();
  if (item.sku.toLowerCase() === raw) return true;
  if (item.upc && item.upc.toLowerCase() === raw) return true;
  if (
    parsed.locationCode &&
    item.locationCode &&
    item.locationCode.toLowerCase() === parsed.locationCode.toLowerCase()
  ) {
    return true;
  }

  if (parsed.upc && item.upc && item.upc.toLowerCase() === parsed.upc.toLowerCase()) {
    if (parsed.sku && item.sku.toLowerCase() !== parsed.sku.toLowerCase()) return false;
    if (parsed.batch && (item.batch ?? "") !== parsed.batch) return false;
    return true;
  }

  if (parsed.sku && item.sku.toLowerCase() === parsed.sku.toLowerCase()) {
    if (parsed.batch && (item.batch ?? "") !== parsed.batch) return false;
    return true;
  }

  return false;
}

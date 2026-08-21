export type ScanPayload = {
  raw: string;
  sku?: string;
  upc?: string;
  batch?: string;
  locationCode?: string;
};

export function encodeScanPayload(input: {
  sku: string;
  upc?: string;
  batch?: string | null;
}): string {
  return JSON.stringify({
    v: 1,
    type: "item",
    sku: input.sku,
    upc: input.upc || undefined,
    batch: input.batch || undefined,
  });
}

export function encodeLocationPayload(input: {
  code: string;
  room?: string | null;
}): string {
  return JSON.stringify({
    v: 1,
    type: "location",
    code: input.code,
    room: input.room || undefined,
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
      return {
        raw,
        sku: emptyToUndefined(parsed.sku),
        upc: emptyToUndefined(parsed.upc),
        batch: emptyToUndefined(parsed.batch),
        locationCode: emptyToUndefined(parsed.locationCode),
      };
    } catch {
      return { raw };
    }
  }

  if (raw.startsWith("saltbox://") || /^https?:\/\//i.test(raw)) {
    try {
      const normalized = raw
        .replace(/^saltbox:\/\/item/i, "https://saltbox.local/item")
        .replace(/^saltbox:\/\/location/i, "https://saltbox.local/location");
      const url = new URL(normalized);
      if (url.pathname.includes("location")) {
        return {
          raw,
          locationCode:
            emptyToUndefined(url.searchParams.get("code")) ??
            emptyToUndefined(url.searchParams.get("location")),
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

  if (/^\d{8,14}$/.test(raw)) {
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
  },
  parsed: ScanPayload,
): boolean {
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

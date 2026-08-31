export function formatDateTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function localDateTimeValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIsoDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function uniqueSkuCount(items: { sku: string }[]): number {
  return new Set(items.map((item) => item.sku)).size;
}

export function formatSignedInt(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatPalletHeading(pallet: {
  palletNumber: string;
  isPartial?: boolean;
  trackingNumber?: string;
}): string {
  const parts = [`Pallet ${pallet.palletNumber}`];
  if (pallet.isPartial) parts.push("partial");
  if (pallet.trackingNumber) parts.push(`tracking ${pallet.trackingNumber}`);
  return parts.join(" · ");
}

export function formatCaseItemLine(item: {
  sku: string;
  upc: string;
  quantityInCase: number;
  manufacturer?: string;
  color?: string | null;
  fiber?: {
    isFiber?: boolean;
    connectionType?: string | null;
    strandCount?: number | null;
  } | null;
}): string {
  const parts = [item.sku, `UPC ${item.upc}`, `qty ${item.quantityInCase}`];
  if (item.manufacturer) parts.push(item.manufacturer);
  if (item.color) parts.push(item.color);
  if (item.fiber?.isFiber) {
    parts.push(
      `fiber ${item.fiber.connectionType ?? ""} ${item.fiber.strandCount ?? ""}ct`.trim(),
    );
  }
  return parts.join(" · ");
}

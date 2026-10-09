export function normalizeProjectId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function inventoryKey(
  sku: string,
  batch: string | null,
  locationId: string,
  projectId?: string | null,
): string {
  return `${sku}::${batch ?? ""}::${locationId}::${normalizeProjectId(projectId) ?? ""}`;
}

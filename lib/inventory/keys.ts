export function inventoryKey(
  sku: string,
  batch: string | null,
  locationId: string,
): string {
  return `${sku}::${batch ?? ""}::${locationId}`;
}

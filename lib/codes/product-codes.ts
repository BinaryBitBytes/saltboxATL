import type { InventorySystem } from "@/lib/inventory-schema";
import { SkuSchema, UpcSchema } from "@/lib/validation/fields";
import { ValidationError } from "@/lib/validation/errors";
import { isSku, isUpc } from "@/lib/validation/sanitize";

export type KnownProduct = {
  sku: string;
  upc: string;
  description: string;
  caseId?: string;
};

export function normalizeCode(value: string): string {
  return value.trim();
}

export function slugFromDescription(description: string): string {
  const slug = description
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "ITEM";
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function upcCheckDigit(elevenDigits: string): string {
  const digits = elevenDigits.split("").map(Number);
  const sum = digits.reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}

export function generateUpcCandidate(seed: string, attempt: number): string {
  const numeric = String(Number.parseInt(fingerprint(`${seed}:${attempt}`), 16));
  const body = `20${numeric.padStart(9, "0").slice(-9)}`;
  return `${body}${upcCheckDigit(body)}`;
}

export function generateSkuCandidate(description: string, attempt: number): string {
  const slug = slugFromDescription(description);
  const suffix = fingerprint(`${description}:${attempt}`).slice(0, 4).toUpperCase();
  const sku = attempt === 0 ? `SBX-${slug}` : `SBX-${slug}-${suffix}`;
  return sku.slice(0, 64);
}

export function collectKnownProducts(
  system: InventorySystem,
  options: { excludeCaseId?: string } = {},
): KnownProduct[] {
  const products: KnownProduct[] = [];

  for (const item of system.inventoryItems) {
    if (!item.sku || !item.upc) continue;
    products.push({
      sku: item.sku,
      upc: item.upc,
      description: item.description || item.sku,
    });
  }

  for (const order of system.receivingOrders) {
    for (const pallet of order.pallets) {
      for (const caseItem of pallet.cases) {
        if (options.excludeCaseId && caseItem.id === options.excludeCaseId) {
          continue;
        }
        products.push({
          sku: caseItem.sku,
          upc: caseItem.upc,
          description: caseItem.description,
          caseId: caseItem.id,
        });
      }
    }
  }

  return products;
}

export function findProductBySku(
  products: KnownProduct[],
  sku: string,
): KnownProduct | undefined {
  const needle = normalizeCode(sku).toLowerCase();
  return products.find((product) => product.sku.toLowerCase() === needle);
}

export function findProductByUpc(
  products: KnownProduct[],
  upc: string,
): KnownProduct | undefined {
  const needle = normalizeCode(upc).toLowerCase();
  return products.find((product) => product.upc.toLowerCase() === needle);
}

export function findProductByDescription(
  products: KnownProduct[],
  description: string,
): KnownProduct | undefined {
  const needle = description.trim().toLowerCase();
  if (!needle) return undefined;
  return products.find(
    (product) => product.description.trim().toLowerCase() === needle,
  );
}

export function usedSkuSet(products: KnownProduct[]): Set<string> {
  return new Set(products.map((product) => product.sku.toLowerCase()));
}

export function usedUpcSet(products: KnownProduct[]): Set<string> {
  return new Set(products.map((product) => product.upc.toLowerCase()));
}

export function generateUniqueSku(
  description: string,
  products: KnownProduct[],
): string {
  const used = usedSkuSet(products);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateSkuCandidate(description, attempt);
    if (isSku(candidate) && !used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new ValidationError("Unable to auto-generate a unique SKU. Enter one manually.");
}

export function generateUniqueUpc(
  seed: string,
  products: KnownProduct[],
): string {
  const used = usedUpcSet(products);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateUpcCandidate(seed, attempt);
    if (isUpc(candidate) && !used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  throw new ValidationError("Unable to auto-generate a unique UPC. Enter one manually.");
}

export function assertProductCodePair(
  sku: string,
  upc: string,
  products: KnownProduct[],
): void {
  const skuMatch = findProductBySku(products, sku);
  if (skuMatch && skuMatch.upc.toLowerCase() !== upc.toLowerCase()) {
    throw new ValidationError(
      `SKU ${sku} is already assigned to UPC ${skuMatch.upc}. Duplicate SKUs are not allowed.`,
    );
  }

  const upcMatch = findProductByUpc(products, upc);
  if (upcMatch && upcMatch.sku.toLowerCase() !== sku.toLowerCase()) {
    throw new ValidationError(
      `UPC ${upc} is already assigned to SKU ${upcMatch.sku}. Duplicate UPCs are not allowed.`,
    );
  }
}

export function resolveReceivingProductCodes(input: {
  description: string;
  sku?: string;
  upc?: string;
  generateSku?: boolean;
  generateUpc?: boolean;
  products: KnownProduct[];
}): { sku: string; upc: string } {
  const description = input.description.trim();
  const generateSku = Boolean(input.generateSku);
  const generateUpc = Boolean(input.generateUpc);
  let sku = normalizeCode(input.sku ?? "");
  let upc = normalizeCode(input.upc ?? "");

  if ((generateSku || generateUpc) && description.length === 0) {
    throw new ValidationError(
      "Enter a case / item description before auto-generating a UPC or SKU.",
    );
  }

  const byDescription = findProductByDescription(input.products, description);
  const bySku = sku ? findProductBySku(input.products, sku) : undefined;
  const byUpc = upc ? findProductByUpc(input.products, upc) : undefined;

  if (generateSku) {
    sku = byDescription?.sku || byUpc?.sku || generateUniqueSku(description, input.products);
  }

  if (generateUpc) {
    const skuProduct = sku ? findProductBySku(input.products, sku) : undefined;
    upc =
      skuProduct?.upc ||
      byDescription?.upc ||
      bySku?.upc ||
      generateUniqueUpc(`${description}:${sku}`, input.products);
  }

  if (!sku) {
    throw new ValidationError(
      "Enter a vendor SKU or auto-generate one after adding a description.",
    );
  }
  if (!upc) {
    throw new ValidationError(
      "Enter a vendor UPC or auto-generate one after adding a description.",
    );
  }

  const skuParsed = SkuSchema.safeParse(sku);
  if (!skuParsed.success) {
    throw new ValidationError(
      "SKU may only include letters, numbers, dots, underscores, slashes, and hyphens.",
    );
  }
  const upcParsed = UpcSchema.safeParse(upc);
  if (!upcParsed.success) {
    throw new ValidationError("UPC may only include letters, numbers, and hyphens.");
  }

  assertProductCodePair(skuParsed.data, upcParsed.data, input.products);
  return { sku: skuParsed.data, upc: upcParsed.data };
}

import { inventoryKey, normalizeProjectId } from "@/lib/inventory/keys";
import { ValidationError } from "@/lib/validation/errors";

export function distinctProjectIds(
  projectIds: Array<string | null | undefined>,
): Array<string | null> {
  const seen = new Set<string>();
  const result: Array<string | null> = [];
  for (const projectId of projectIds) {
    const normalized = normalizeProjectId(projectId);
    const key = normalized ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function combineNeedsApproval(
  projectIds: Array<string | null | undefined>,
): boolean {
  return projectIds.some((projectId) => normalizeProjectId(projectId) != null);
}

export function assertProjectCombineAllowed(input: {
  projectIds: Array<string | null | undefined>;
  approved: boolean;
  approverIsAdmin: boolean;
}): void {
  if (!combineNeedsApproval(input.projectIds)) return;
  if (input.approved && input.approverIsAdmin) return;
  const labels = distinctProjectIds(input.projectIds).filter(
    (projectId): projectId is string => projectId != null,
  );
  throw new ValidationError(
    `Combining inventory tracked by project ID ${labels.join(", ")} requires administrative approval.`,
  );
}

export function putawayMergesExistingProjectStock(input: {
  items: Array<{
    sku: string;
    batch: string | null;
    locationId: string;
    projectId?: string | null;
    quantity: number;
  }>;
  cases: Array<{
    sku: string;
    batch: string | null;
    putawayLocationId?: string | null;
  }>;
  projectId: string | null | undefined;
}): boolean {
  const projectId = normalizeProjectId(input.projectId);
  if (!projectId) return false;
  const preexisting = new Set(
    input.items
      .filter(
        (item) => item.quantity > 0 && normalizeProjectId(item.projectId) === projectId,
      )
      .map((item) => inventoryKey(item.sku, item.batch, item.locationId, item.projectId)),
  );
  return input.cases.some((item) => {
    if (!item.putawayLocationId) return false;
    return preexisting.has(
      inventoryKey(item.sku, item.batch, item.putawayLocationId, projectId),
    );
  });
}

export function resolveCombinedProjectId(
  projectIds: Array<string | null | undefined>,
  requested?: string | null,
): string | null {
  const distinct = distinctProjectIds(projectIds);
  if (distinct.length === 1) return distinct[0] ?? null;
  if (requested === undefined) {
    const labels = distinct.map((projectId) => projectId ?? "untracked");
    throw new ValidationError(
      `Choose the project ID to keep when combining ${labels.join(" and ")}.`,
    );
  }
  const chosen = normalizeProjectId(requested);
  const allowed = new Set(distinct.map((projectId) => projectId ?? ""));
  if (!allowed.has(chosen ?? "")) {
    const labels = distinct.map((projectId) => projectId ?? "untracked");
    throw new ValidationError(
      `Choose the project ID to keep when combining ${labels.join(" and ")}.`,
    );
  }
  return chosen;
}

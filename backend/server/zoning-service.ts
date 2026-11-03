import { parseWithSchema } from "@/backend/server/safeParsing";
import { ServiceError } from "@/backend/server/inventory-service";
import { resolveActiveDivision } from "@/backend/server/division";
import { updateSystem } from "@/backend/server/store";
import {
  CategorizeInventoryLinesInputSchema,
  GenerateZoneLocationsInputSchema,
} from "@/lib/inventory-schema";
import { NomenclatureError } from "@/lib/locations/hierarchy";
import {
  applyZoneLocations,
  categorizeInventoryLines,
  type ZoneGenerationResult,
} from "@/lib/locations/zoning";

function failZoning(error: unknown): never {
  if (error instanceof NomenclatureError) {
    throw new ServiceError(error.message);
  }
  throw error;
}

export async function generateZoneLocationsRecord(
  rawData: unknown,
): Promise<ZoneGenerationResult> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(GenerateZoneLocationsInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return applyZoneLocations(system, division, parsed.data);
    } catch (error) {
      failZoning(error);
    }
  });
}

export async function categorizeInventoryLinesRecord(
  rawData: unknown,
): Promise<{ updated: number }> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CategorizeInventoryLinesInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  const updated = await updateSystem((system) => {
    try {
      return categorizeInventoryLines(system, division, parsed.data);
    } catch (error) {
      failZoning(error);
    }
  });
  return { updated };
}

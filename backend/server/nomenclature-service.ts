import { parseWithSchema } from "@/backend/server/safeParsing";
import { ServiceError } from "@/backend/server/inventory-service";
import { resolveActiveDivision } from "@/backend/server/division";
import { updateSystem } from "@/backend/server/store";
import {
  addAisle,
  addBay,
  addBuilding,
  addContainer,
  addLicensePlate,
  addSite,
  addTrailer,
  addZone,
  NomenclatureError,
} from "@/lib/locations/hierarchy";
import {
  CreateAisleInputSchema,
  CreateBayInputSchema,
  CreateBuildingInputSchema,
  CreateContainerInputSchema,
  CreateLicensePlateInputSchema,
  CreateSiteInputSchema,
  CreateTrailerInputSchema,
  CreateZoneInputSchema,
  type Aisle,
  type Bay,
  type Building,
  type Container,
  type LicensePlate,
  type Site,
  type Trailer,
  type Zone,
} from "@/lib/inventory-schema";

function failNomenclature(error: unknown): never {
  if (error instanceof NomenclatureError) {
    throw new ServiceError(error.message);
  }
  throw error;
}

export async function createSiteRecord(rawData: unknown): Promise<Site> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateSiteInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addSite(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createBuildingRecord(rawData: unknown): Promise<Building> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateBuildingInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addBuilding(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createZoneRecord(rawData: unknown): Promise<Zone> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateZoneInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addZone(system, {
        ...parsed.data,
        division,
        projectId: parsed.data.projectId ?? null,
        poNumber: parsed.data.poNumber ?? null,
      });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createAisleRecord(rawData: unknown): Promise<Aisle> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateAisleInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addAisle(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createBayRecord(rawData: unknown): Promise<Bay> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateBayInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addBay(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createTrailerRecord(rawData: unknown): Promise<Trailer> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateTrailerInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addTrailer(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createLicensePlateRecord(
  rawData: unknown,
  issuedBy?: string | null,
): Promise<LicensePlate> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateLicensePlateInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addLicensePlate(system, { ...parsed.data, division, issuedBy });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

export async function createContainerRecord(rawData: unknown): Promise<Container> {
  const division = await resolveActiveDivision();
  const parsed = parseWithSchema(CreateContainerInputSchema, rawData);
  if (!parsed.success) throw new ServiceError(parsed.error);
  return updateSystem((system) => {
    try {
      return addContainer(system, { ...parsed.data, division });
    } catch (error) {
      failNomenclature(error);
    }
  });
}

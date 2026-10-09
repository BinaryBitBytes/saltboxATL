/** Full pallet slot: 48 in × 40 in × 72 in. */
export const DEFAULT_PALLET_CUBE_CUBIC_INCHES = 48 * 40 * 72;

/** Racked opening: 42 in × 18 in × 24 in. Smaller than a full pallet slot. */
export const DEFAULT_RACK_CUBE_CUBIC_INCHES = 42 * 18 * 24;

/** Inbound dock lane: 48 in × 40 in × 96 in. */
export const DEFAULT_STAGING_CUBE_CUBIC_INCHES = 48 * 40 * 96;

export const DEFAULT_HOLD_CUBE_CUBIC_INCHES = DEFAULT_PALLET_CUBE_CUBIC_INCHES;

export const QUARTER_INCH = 0.25;

/** A transfer trailer sized for 26 full pallet positions. */
export const DEFAULT_CONTAINER_CUBE_CUBIC_INCHES = 26 * DEFAULT_PALLET_CUBE_CUBIC_INCHES;

export type StorageClass = "pallet" | "rack" | "staging" | "hold" | "container";

export type MeasuredCube = {
  lengthInches: number;
  widthInches: number;
  heightInches: number;
  cubicInches: number;
};

export function roundCube(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function cubeExceeds(used: number, capacity: number): boolean {
  return roundCube(used) > roundCube(capacity) + 0.001;
}

/**
 * Round a measurement up to the next quarter inch.
 * 10 stays 10. 10.01 and 10.25 become 10.25. 10.26 becomes 10.5.
 */
export function roundUpToQuarterInch(inches: number): number {
  if (!Number.isFinite(inches) || inches <= 0) {
    throw new Error("Each dimension must be a positive number of inches.");
  }
  const milli = Math.round(inches * 1000);
  if (milli <= 0) {
    throw new Error("Each dimension must be a positive number of inches.");
  }
  const quarters = Math.ceil(milli / 250);
  return quarters / 4;
}

export function measureCaseCube(
  lengthInches: number,
  widthInches: number,
  heightInches: number,
): MeasuredCube {
  const length = roundUpToQuarterInch(lengthInches);
  const width = roundUpToQuarterInch(widthInches);
  const height = roundUpToQuarterInch(heightInches);
  return {
    lengthInches: length,
    widthInches: width,
    heightInches: height,
    cubicInches: roundCube(length * width * height),
  };
}

export function caseCubicInches(
  quantity: number,
  cube: { cubicInches: number; unitsPerCase: number },
): number {
  if (quantity <= 0 || cube.unitsPerCase <= 0) return 0;
  return roundCube((quantity / cube.unitsPerCase) * cube.cubicInches);
}

export function defaultStorageClass(code: string): StorageClass {
  const normalized = code.trim().toUpperCase();
  if (normalized.startsWith("DOCK") || normalized.includes("STAGE")) return "staging";
  if (normalized.startsWith("DMG") || normalized.includes("HOLD")) return "hold";
  if (normalized.startsWith("PLT") || normalized.includes("PALLET")) return "pallet";
  if (
    normalized.startsWith("TRL") ||
    normalized.includes("TRAILER") ||
    normalized.includes("CONTAINER")
  ) {
    return "container";
  }
  return "rack";
}

export function defaultCubeCapacity(storageClass: StorageClass): number {
  if (storageClass === "pallet") return DEFAULT_PALLET_CUBE_CUBIC_INCHES;
  if (storageClass === "staging") return DEFAULT_STAGING_CUBE_CUBIC_INCHES;
  if (storageClass === "hold") return DEFAULT_HOLD_CUBE_CUBIC_INCHES;
  if (storageClass === "container") return DEFAULT_CONTAINER_CUBE_CUBIC_INCHES;
  return DEFAULT_RACK_CUBE_CUBIC_INCHES;
}

export function formatInches(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/0$/, "")} in`;
}

export function formatCubicInches(value: number): string {
  const inches = roundCube(value).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  const feet = (value / 1728).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  return `${inches} cu in (${feet} cu ft)`;
}

export function storageClassLabel(storageClass: StorageClass): string {
  if (storageClass === "pallet") return "Full pallet";
  if (storageClass === "rack") return "Racked";
  if (storageClass === "staging") return "Staging";
  if (storageClass === "container") return "Transfer trailer";
  return "Hold";
}

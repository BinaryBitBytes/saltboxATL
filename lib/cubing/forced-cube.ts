export const FORCED_CUBE_LABEL = "Forced cube";

export const FORCED_CUBE_ROW_CLASS = "bg-destructive/15 hover:bg-destructive/25";

export function isForcedCube(
  record: { cubeForced?: boolean | null } | null | undefined,
): boolean {
  return record?.cubeForced === true;
}

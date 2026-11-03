import { binMixError, type BinOccupant } from "@/lib/inventory/bin-container";
import {
  caseCubicInches,
  cubeExceeds,
  DEFAULT_RACK_CUBE_CUBIC_INCHES,
  formatCubicInches,
  roundCube,
} from "@/lib/cubing/measure";
import {
  locationHomeError,
  projectConflict,
  unitsThatFit,
  type PutawaySlice,
  type PutawaySlot,
} from "@/lib/cubing/putaway-allocation";
import type { ItemCube, PurchaseOrder, ReceivingOrder } from "@/lib/inventory-schema";

export type ReceivingRoute = "shelf" | "rack" | "pallet";

type ShelfCubeSource = {
  isActive: boolean;
  storageClass: string;
  slotKind?: "pick" | "overhead" | null;
  cubeCapacityCubicInches: number;
  division?: string | null;
  siteId?: string | null;
  code?: string;
};

export type ReceivingLineInput = {
  quantity: number;
  cubicInchesPerUnit: number;
  /** Receiver checkbox. Used only when the line is larger than a shelf slot. */
  fullPallet?: boolean;
  projectId: string | null;
  poNumber?: string | null;
  sku: string;
  batch?: string | null;
  division: string;
  siteId: string;
  locations: readonly PutawaySlot[];
};

export type ReceivingLinePlan = {
  ok: true;
  directed: boolean;
  exceedsShelf: boolean;
  fullPallet: boolean | null;
  route: ReceivingRoute | null;
  shelfCube: number;
  lineCube: number;
  slices: PutawaySlice[];
  verification: string;
};

export type ReceivingLineResult = ReceivingLinePlan | { ok: false; error: string };

/**
 * Cube of a shelf slot: the largest active pick face or unstructured rack.
 * Overhead openings are racks, and pallet locations are not shelves.
 * When the building has no shelf, the standard rack opening is the threshold.
 */
export function shelfSlotCube(
  locations: readonly ShelfCubeSource[],
  home?: { division: string; siteId: string },
): number {
  const shelves = locations.filter((location) => {
    if (!isShelfSource(location)) return false;
    if (!home) return true;
    return (
      locationHomeError(
        {
          code: location.code ?? "shelf",
          division: location.division ?? null,
          siteId: location.siteId ?? null,
        },
        home.division,
        home.siteId,
      ) == null
    );
  });
  if (shelves.length === 0) return DEFAULT_RACK_CUBE_CUBIC_INCHES;
  return Math.max(...shelves.map((location) => location.cubeCapacityCubicInches));
}

function isShelfSource(location: ShelfCubeSource): boolean {
  return (
    location.isActive &&
    location.storageClass === "rack" &&
    location.slotKind !== "overhead"
  );
}

function isShelfSlot(slot: PutawaySlot): boolean {
  return isShelfSource(slot);
}

/** Overhead openings and unstructured rack locations. Pick faces stay shelves. */
function isRackSlot(slot: PutawaySlot): boolean {
  return slot.isActive && slot.storageClass === "rack" && slot.slotKind !== "pick";
}

function isPalletSlot(slot: PutawaySlot): boolean {
  return slot.isActive && slot.storageClass === "pallet";
}

function projectKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function openCube(slot: PutawaySlot): number {
  return roundCube(Math.max(0, slot.cubeCapacityCubicInches - slot.committedCubicInches));
}

function incomingOccupant(input: ReceivingLineInput, quantity: number): BinOccupant {
  return {
    sku: input.sku,
    batch: input.batch,
    quantity,
    poNumber: input.poNumber,
    jobIdNumber: input.projectId,
  };
}

function slotAccepts(slot: PutawaySlot, input: ReceivingLineInput, quantity: number): boolean {
  if (locationHomeError(slot, input.division, input.siteId)) return false;
  if (projectConflict(input.projectId, slot)) return false;
  return binMixError(incomingOccupant(input, quantity), slot.occupants, slot.code) == null;
}

function palletClass(slot: PutawaySlot, projectId: string | null): number {
  const project = projectKey(slot.zoneProjectId);
  const incoming = projectKey(projectId);
  const dedicated = Boolean(incoming) && project === incoming;
  const palletZone = slot.zoneCubeSize === "pallet";
  if (dedicated && palletZone) return 0;
  if (dedicated) return 1;
  if (!project && palletZone) return 2;
  return 3;
}

function compareCode(left: PutawaySlot, right: PutawaySlot): number {
  const leftOpen = openCube(left);
  const rightOpen = openCube(right);
  if (leftOpen !== rightOpen) return leftOpen - rightOpen;
  return left.code.localeCompare(right.code);
}

function sliceFor(slot: PutawaySlot, quantity: number, perUnit: number): PutawaySlice {
  return {
    locationId: slot.id,
    locationCode: slot.code,
    roomId: slot.roomId,
    quantity,
    cubicInches: roundCube(quantity * perUnit),
    role: "primary",
  };
}

function claim(slot: PutawaySlot, input: ReceivingLineInput, quantity: number, perUnit: number): void {
  slot.committedCubicInches = roundCube(slot.committedCubicInches + quantity * perUnit);
  slot.occupants.push(incomingOccupant(input, quantity));
}

function describe(route: ReceivingRoute, sku: string, slices: PutawaySlice[]): string {
  const first = slices[0];
  if (!first) return "Nothing was allocated.";
  if (route === "pallet") {
    return `Full pallet of ${sku} directed to ${first.locationCode}.`;
  }
  if (slices.length === 1) {
    const place = route === "rack" ? "rack slot" : "shelf slot";
    return `${first.quantity} units of ${sku} directed to ${place} ${first.locationCode}.`;
  }
  const place = route === "rack" ? "rack slots" : "shelf slots";
  const parts = slices.map((slice) => `${slice.quantity} in ${slice.locationCode}`).join(", ");
  return `${sku} directed to ${place}: ${parts}.`;
}

function undirected(input: ReceivingLineInput, shelfCube: number): ReceivingLinePlan {
  return {
    ok: true,
    directed: false,
    exceedsShelf: false,
    fullPallet: null,
    route: null,
    shelfCube,
    lineCube: 0,
    slices: [],
    verification: `Cube ${input.sku} on the Cubing tab before this line can be directed to a location.`,
  };
}

/**
 * Direct one receiving line.
 * A line that fits a shelf slot goes to an open shelf.
 * A larger line asks the receiver, via `fullPallet`, whether it is a full pallet.
 * A full pallet goes to that project's pallet zone. Anything else goes to rack slots.
 */
export function allocateReceivingLine(input: ReceivingLineInput): ReceivingLineResult {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, error: "Putaway quantity must be a positive whole number." };
  }
  const shelfCube = shelfSlotCube(input.locations, {
    division: input.division,
    siteId: input.siteId,
  });
  const perUnit = roundCube(input.cubicInchesPerUnit);
  if (perUnit <= 0) return undirected(input, shelfCube);

  const lineCube = roundCube(input.quantity * perUnit);
  const exceedsShelf = cubeExceeds(lineCube, shelfCube);
  const fullPallet = exceedsShelf ? input.fullPallet === true : null;
  const route: ReceivingRoute = !exceedsShelf ? "shelf" : fullPallet ? "pallet" : "rack";
  const working = input.locations.map((slot) => ({
    ...slot,
    occupants: slot.occupants.map((occupant) => ({ ...occupant })),
  }));
  const pool = working.filter((slot) =>
    route === "shelf" ? isShelfSlot(slot) : route === "rack" ? isRackSlot(slot) : isPalletSlot(slot),
  );

  if (route === "pallet") {
    const chosen = pool
      .filter(
        (slot) =>
          slotAccepts(slot, input, input.quantity) &&
          unitsThatFit(openCube(slot), perUnit) >= input.quantity,
      )
      .sort((left, right) => {
        const rank = palletClass(left, input.projectId) - palletClass(right, input.projectId);
        if (rank !== 0) return rank;
        return compareCode(left, right);
      });
    const slot = chosen[0];
    if (!slot) {
      return {
        ok: false,
        error: `No open location in the full pallet zone can hold this line of ${input.sku} (${formatCubicInches(lineCube)}). Leave full pallet unchecked to put it in a rack slot, or free a pallet location.`,
      };
    }
    const slices = [sliceFor(slot, input.quantity, perUnit)];
    return {
      ok: true,
      directed: true,
      exceedsShelf,
      fullPallet,
      route,
      shelfCube,
      lineCube,
      slices,
      verification: describe(route, input.sku, slices),
    };
  }

  const ranked = pool.sort((left, right) => {
    const leftFits = unitsThatFit(openCube(left), perUnit) >= input.quantity ? 0 : 1;
    const rightFits = unitsThatFit(openCube(right), perUnit) >= input.quantity ? 0 : 1;
    if (leftFits !== rightFits) return leftFits - rightFits;
    const leftKind =
      route === "rack" ? (left.slotKind === "overhead" ? 0 : 1) : left.slotKind === "pick" ? 0 : 1;
    const rightKind =
      route === "rack"
        ? (right.slotKind === "overhead" ? 0 : 1)
        : right.slotKind === "pick"
          ? 0
          : 1;
    if (leftKind !== rightKind) return leftKind - rightKind;
    return compareCode(left, right);
  });

  const slices: PutawaySlice[] = [];
  let remaining = input.quantity;
  for (const slot of ranked) {
    if (remaining <= 0) break;
    const fit = unitsThatFit(openCube(slot), perUnit);
    if (fit <= 0) continue;
    const take = Math.min(remaining, fit);
    if (!slotAccepts(slot, input, take)) continue;
    slices.push(sliceFor(slot, take, perUnit));
    claim(slot, input, take, perUnit);
    remaining -= take;
  }

  if (remaining > 0) {
    const place = route === "rack" ? "rack slot" : "shelf slot";
    return {
      ok: false,
      error: `No open ${place} in this division and site can hold the remaining ${remaining} units of ${input.sku} without mixing project IDs.`,
    };
  }

  return {
    ok: true,
    directed: true,
    exceedsShelf,
    fullPallet,
    route,
    shelfCube,
    lineCube,
    slices,
    verification: describe(route, input.sku, slices),
  };
}

type ReservedCase = {
  id: string;
  sku: string;
  batch?: string | null;
  quantityInCase: number;
  putawayLocationId?: string | null;
  putawayPostedAt?: string | null;
};

/**
 * Cube already assigned on draft and in-progress receipts.
 * Received orders are already counted by the putaway slot builder.
 */
type OpenReceipt = {
  status: ReceivingOrder["status"];
  poNumber: string;
  pallets: readonly { cases: readonly ReservedCase[] }[];
};

export function withOpenReceivingReservations(
  slots: readonly PutawaySlot[],
  input: {
    orders: readonly OpenReceipt[];
    cubes: readonly Pick<ItemCube, "sku" | "cubicInches" | "unitsPerCase">[];
    purchaseOrders?: readonly Pick<PurchaseOrder, "purchaseOrderNumber" | "jobIdNumber">[];
    excludeCaseIds?: ReadonlySet<string>;
  },
): PutawaySlot[] {
  const next = slots.map((slot) => ({
    ...slot,
    occupants: slot.occupants.map((occupant) => ({ ...occupant })),
  }));
  const byId = new Map(next.map((slot) => [slot.id, slot]));
  const profiles = new Map(input.cubes.map((cube) => [cube.sku, cube]));
  for (const order of input.orders) {
    if (order.status !== "draft" && order.status !== "in-progress") continue;
    const projectId =
      input.purchaseOrders?.find((entry) => entry.purchaseOrderNumber === order.poNumber)
        ?.jobIdNumber ?? null;
    for (const pallet of order.pallets) {
      for (const item of pallet.cases as readonly ReservedCase[]) {
        if (!item.putawayLocationId || item.putawayPostedAt) continue;
        if (input.excludeCaseIds?.has(item.id)) continue;
        const slot = byId.get(item.putawayLocationId);
        if (!slot) continue;
        const profile = profiles.get(item.sku);
        if (profile) {
          slot.committedCubicInches = roundCube(
            slot.committedCubicInches + caseCubicInches(item.quantityInCase, profile),
          );
        }
        slot.occupants.push({
          sku: item.sku,
          batch: item.batch,
          quantity: item.quantityInCase,
          poNumber: order.poNumber,
          jobIdNumber: projectId,
        });
      }
    }
  }
  return next;
}

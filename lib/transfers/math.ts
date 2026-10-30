import type { FacilityTransferLine } from "@/lib/inventory-schema";

export type TransferUnitBalance = {
  loaded: number;
  received: number;
  inTransit: number;
  routed: number;
  lineCount: number;
  balanced: boolean;
};

type BalanceLine = Pick<
  FacilityTransferLine,
  "quantityLoaded" | "quantityReceived" | "routes"
>;

/** Loaded units stay equal to received units plus freight still on the trailer. */
export function transferUnitBalance(
  transfer: { lines: readonly BalanceLine[] },
): TransferUnitBalance {
  let loaded = 0;
  let received = 0;
  let routed = 0;
  let linesOk = true;

  for (const line of transfer.lines) {
    const routeSum = line.routes.reduce((sum, route) => sum + route.quantity, 0);
    if (!Number.isInteger(line.quantityLoaded) || line.quantityLoaded < 1) linesOk = false;
    if (!Number.isInteger(line.quantityReceived) || line.quantityReceived < 0) linesOk = false;
    if (line.quantityReceived > line.quantityLoaded) linesOk = false;
    if (routeSum !== line.quantityReceived) linesOk = false;
    loaded += line.quantityLoaded;
    received += line.quantityReceived;
    routed += routeSum;
  }

  const inTransit = loaded - received;
  return {
    loaded,
    received,
    inTransit,
    routed,
    lineCount: transfer.lines.length,
    balanced:
      linesOk &&
      inTransit >= 0 &&
      loaded === received + inTransit &&
      routed === received,
  };
}

export function lineOpenQuantity(line: {
  quantityLoaded: number;
  quantityReceived: number;
}): number {
  return line.quantityLoaded - line.quantityReceived;
}

export function stockChangesBalance(
  changes: readonly {
    quantityBefore: number;
    quantityAfter: number;
    quantityDelta: number;
  }[],
): boolean {
  return changes.every(
    (change) =>
      change.quantityBefore >= 0 &&
      change.quantityAfter >= 0 &&
      change.quantityBefore + change.quantityDelta === change.quantityAfter,
  );
}

/**
 * Source decreases become trailer inventory until the destination increase
 * catches up. The three quantities close to zero for the life of the transfer.
 */
export function netTransferMovement(input: {
  outboundDeltas: readonly number[];
  inboundDeltas: readonly number[];
  inTransit: number;
}): {
  outbound: number;
  inbound: number;
  inTransit: number;
  closed: boolean;
} {
  const outbound = input.outboundDeltas.reduce((sum, delta) => sum + delta, 0);
  const inbound = input.inboundDeltas.reduce((sum, delta) => sum + delta, 0);
  return {
    outbound,
    inbound,
    inTransit: input.inTransit,
    closed: outbound + inbound + input.inTransit === 0,
  };
}

/** On-hand stock plus freight still on the trailer stays at the starting total. */
export function onHandConserved(input: {
  onHandAtStart: number;
  onHandNow: number;
  inTransit: number;
}): boolean {
  return input.onHandNow + input.inTransit === input.onHandAtStart;
}

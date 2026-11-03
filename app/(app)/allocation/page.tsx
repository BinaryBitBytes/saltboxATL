import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import {
  pickAllocatedQuantity,
  reportPicksAgainst,
} from "@/lib/allocation/workflow";
import { reservedQuantity } from "@/lib/orders/availability";
import type { CaseItem } from "@/lib/inventory-schema";
import {
  AllocationWorkspace,
  type AllocationPickView,
  type PendingAllocationLine,
} from "@/frontend/client/allocation-workspace";

function pickViews(
  picks: ReturnType<typeof reportPicksAgainst>,
): AllocationPickView[] {
  return picks.map((pick) => ({
    orderNumber: pick.orderNumber,
    pickRequestNumber: pick.pickRequestNumber,
    quantityNeeded: pick.quantityNeeded,
    quantityCovered: pick.quantityCovered,
  }));
}

function routeLabel(item: CaseItem): PendingAllocationLine["routeLabel"] {
  if (item.fullPallet === true) return "Full pallet";
  if (item.fullPallet === false) return "Rack slot";
  if (item.putawayLocationId) return "Shelf slot";
  return "Not directed yet";
}

export default async function AllocationPage() {
  await requirePermission("allocateInventory");
  const system = await getSystem();
  const orders = system.customerOrders ?? [];
  const locationCodes = new Map(system.locations.map((location) => [location.id, location.code]));

  const onHand = system.inventoryItems
    .filter((item) => item.quantity > 0)
    .sort((left, right) => left.sku.localeCompare(right.sku))
    .map((item) => {
      const allocatable = Math.max(
        0,
        item.quantity -
          reservedQuantity(orders, item.id) -
          pickAllocatedQuantity(system.allocations, item.id),
      );
      return {
        inventoryItemId: item.id,
        sku: item.sku,
        description: item.description?.trim() || item.sku,
        locationCode: locationCodes.get(item.locationId) ?? item.locationId,
        quantity: item.quantity,
        allocatable,
        picks: pickViews(
          reportPicksAgainst({
            sku: item.sku,
            batch: item.batch,
            quantity: item.quantity,
            orders,
          }),
        ),
      };
    });

  const pending = system.receivingOrders
    .filter((order) => order.status === "draft" || order.status === "in-progress" || order.status === "received")
    .map((order) => {
      const lines = order.pallets.flatMap((pallet) =>
        pallet.cases
          .filter((item) => !item.putawayPostedAt)
          .map((item) => ({
            caseId: item.id,
            sku: item.sku,
            description: item.description,
            quantity: item.quantityInCase,
            locationCode: item.putawayLocationId
              ? locationCodes.get(item.putawayLocationId) ?? item.putawayLocationId
              : null,
            routeLabel: routeLabel(item),
            picks: pickViews(
              reportPicksAgainst({
                sku: item.sku,
                batch: item.batch,
                quantity: item.quantityInCase,
                orders,
              }),
            ),
          })),
      );
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        vendor: order.vendor,
        poNumber: order.poNumber,
        lines,
      };
    })
    .filter((order) => order.lines.length > 0);

  const openAllocations = (system.allocations ?? [])
    .filter((allocation) => allocation.status === "open")
    .map((allocation) => {
      const order = allocation.receivingOrderId
        ? system.receivingOrders.find((entry) => entry.id === allocation.receivingOrderId)
        : undefined;
      return {
        id: allocation.id,
        kind: allocation.kind,
        sku: allocation.sku,
        quantity: allocation.quantity,
        locationCode: locationCodes.get(allocation.locationId) ?? allocation.locationId,
        reference: order?.orderNumber ?? allocation.sku,
        picks: pickViews(
          reportPicksAgainst({
            sku: allocation.sku,
            batch: allocation.batch,
            quantity: allocation.quantity,
            orders,
          }),
        ),
      };
    });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Allocation</T></h1>
        <p className="text-sm text-muted-foreground">
          <T>Allocate received inventory against open picks, or slot pending inventory into a reserved location. Other users cannot move stock into that slot while the allocation is open.</T>
        </p>
      </div>
      <AllocationWorkspace
        onHand={onHand}
        pending={pending}
        openAllocations={openAllocations}
      />
    </div>
  );
}

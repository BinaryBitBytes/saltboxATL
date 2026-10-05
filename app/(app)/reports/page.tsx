import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { buildItemCatalog } from "@/lib/reports/item-report";
import { buildInventoryCountReport } from "@/lib/inventory/count-math";
import { ReportWorkspace } from "@/frontend/client/report-workspace";

export default async function ReportsPage() {
  await requireUser();
  const system = await getSystem();
  const catalog = buildItemCatalog({
    inventoryItems: system.inventoryItems,
    locations: system.locations,
    rooms: system.rooms,
    receivingOrders: system.receivingOrders,
    shippingOrders: system.shippingOrders,
  });
  const count = buildInventoryCountReport({
    items: system.inventoryItems,
    transactions: system.transactions,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Query items by SKU, UPC, purchase order, location, or description,
          then print or export a report of the matches.
        </p>
      </div>
      <ReportWorkspace catalog={catalog} count={count} />
    </div>
  );
}

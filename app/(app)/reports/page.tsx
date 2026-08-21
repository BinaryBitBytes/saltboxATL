import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { buildItemCatalog } from "@/lib/reports/item-report";
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

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Query items by SKU, UPC, purchase order, location, or description,
          then print or export a report of the matches.
        </p>
      </div>
      <ReportWorkspace catalog={catalog} />
    </div>
  );
}

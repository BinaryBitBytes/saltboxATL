import { T } from "@/frontend/client/language";
import { getSystem } from "@/backend/server/store";
import { requireUser } from "@/backend/server/dal";
import { enrichTransactions } from "@/backend/server/inventory-service";
import { TransactionsTable } from "@/frontend/client/transactions-table";

export default async function TransactionsPage() {
  await requireUser();
  const system = await getSystem();
  const rows = enrichTransactions(system);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Transaction log</T></h1>
        <p className="text-sm text-muted-foreground"><T>Every receiving direction, allocation, release, putaway, shipment, cube, zone change, transfer, import, and adjustment. Allocations are blue, releases are yellow, and damaged transactions stay amber. Use the logbook to review whole shipments, deliveries, and damage events.</T></p>
      </div>
      <TransactionsTable initialRows={rows} />
    </div>
  );
}

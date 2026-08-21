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
        <h1 className="font-heading text-xl font-semibold">Transaction log</h1>
        <p className="text-sm text-muted-foreground">
          Every putaway, shipment, overage, shortage, and damage
          adjustment. Proof photos attached to a PO, shipment, or damage
          write-off appear on the matching log lines.
        </p>
      </div>
      <TransactionsTable initialRows={rows} />
    </div>
  );
}

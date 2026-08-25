"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { InventoryTransactionRow } from "@/lib/inventory-schema";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/frontend/client/field";
import { TransactionTypeBadge } from "@/frontend/client/status-badge";
import { formatDateTime, formatSignedInt } from "@/lib/format";
import { ScanInput } from "@/frontend/client/scan-input";
import { PhotoThumbnails } from "@/frontend/client/photo-proof";
import { matchesScan } from "@/lib/scan-code";

const features = tableFeatures({});
const columnHelper =
  createColumnHelper<typeof features, InventoryTransactionRow>();
const EMPTY: InventoryTransactionRow[] = [];

const columns = columnHelper.columns([
  columnHelper.accessor("occurredAt", {
    header: "When",
    cell: ({ getValue }) => formatDateTime(getValue()),
  }),
  columnHelper.accessor("type", {
    header: "Type",
    cell: ({ getValue }) => <TransactionTypeBadge type={getValue()} />,
  }),
  columnHelper.accessor("sku", { header: "SKU" }),
  columnHelper.accessor("locationCode", { header: "Location" }),
  columnHelper.accessor("quantityDelta", {
    header: "Delta",
    cell: ({ getValue }) => formatSignedInt(getValue()),
  }),
  columnHelper.accessor("quantityAfter", {
    header: "After",
    cell: ({ getValue }) => getValue() ?? "—",
  }),
  columnHelper.accessor("reason", {
    header: "Reason",
    cell: ({ getValue }) => getValue() || "—",
  }),
  columnHelper.accessor("photos", {
    header: "Photos",
    cell: ({ getValue }) => <PhotoThumbnails photos={getValue() ?? []} />,
  }),
]);

async function fetchTransactions(): Promise<InventoryTransactionRow[]> {
  const response = await fetch("/api/transactions");
  const json = (await response.json()) as {
    success: boolean;
    data?: InventoryTransactionRow[];
    error?: string;
  };
  if (!json.success || !json.data) {
    throw new Error(json.error || "Unable to load transactions");
  }
  return json.data;
}

export function TransactionsTable({
  initialRows,
}: {
  initialRows: InventoryTransactionRow[];
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const txQuery = useQuery({
    queryKey: ["transactions"],
    queryFn: fetchTransactions,
    initialData: initialRows,
  });

  const filtered = useMemo(() => {
    const rows = txQuery.data ?? EMPTY;
    const needle = query.trim();
    return rows.filter((row) => {
      if (type !== "all" && row.type !== type) return false;
      if (!needle) return true;
      const parsed = { raw: needle, sku: needle, upc: needle };
      return (
        matchesScan(row, parsed) ||
        (row.reason ?? "").toLowerCase().includes(needle.toLowerCase()) ||
        row.locationCode.toLowerCase().includes(needle.toLowerCase())
      );
    });
  }, [query, txQuery.data, type]);

  const table = useTable({
    features,
    columns,
    data: filtered,
    getRowId: (row) => row.id,
  });

  return (
    <div className="grid gap-3">
      <ScanInput
        onScan={(payload) => setQuery(payload.upc || payload.sku || payload.raw)}
        placeholder="Scan or search SKU, UPC, reason, location"
      />
      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter log"
          className="max-w-xs"
        />
        <NativeSelect
          className="w-40"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="all">All types</option>
          <option value="receiving">Receiving</option>
          <option value="putaway">Putaway</option>
          <option value="shipping">Shipping</option>
          <option value="overage">Overage</option>
          <option value="shortage">Shortage</option>
          <option value="damage">Damage</option>
          <option value="import">Import</option>
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-muted-foreground">
                No transactions yet.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

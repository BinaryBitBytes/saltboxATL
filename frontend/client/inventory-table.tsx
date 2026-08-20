"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { InventoryRow } from "@/lib/inventory-schema";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, InventoryRow>();
const EMPTY_ROWS: InventoryRow[] = [];

const columns = columnHelper.columns([
  columnHelper.accessor("sku", { header: "SKU" }),
  columnHelper.accessor("upc", { header: "UPC" }),
  columnHelper.accessor("description", { header: "Description" }),
  columnHelper.accessor("batch", {
    header: "Batch",
    cell: ({ getValue }) => getValue() || "—",
  }),
  columnHelper.accessor("roomName", { header: "Room" }),
  columnHelper.accessor("locationCode", { header: "Location" }),
  columnHelper.accessor("quantity", { header: "Qty" }),
  columnHelper.accessor("lastMovedAt", {
    header: "Last moved",
    cell: ({ getValue }) => formatDateTime(getValue()),
  }),
]);

async function fetchInventory(): Promise<InventoryRow[]> {
  const response = await fetch("/api/inventory");
  const json = (await response.json()) as {
    success: boolean;
    data?: InventoryRow[];
    error?: string;
  };
  if (!json.success || !json.data) {
    throw new Error(json.error || "Unable to load inventory");
  }
  return json.data;
}

export function InventoryTable({ initialRows }: { initialRows: InventoryRow[] }) {
  const [query, setQuery] = useState("");
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
    initialData: initialRows,
  });

  const filtered = useMemo(() => {
    const rows = inventoryQuery.data ?? EMPTY_ROWS;
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.sku, row.upc, row.description, row.batch, row.locationCode, row.roomName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [inventoryQuery.data, query]);

  const table = useTable({
    features,
    columns,
    data: filtered.length ? filtered : query ? filtered : inventoryQuery.data ?? EMPTY_ROWS,
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="grid gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search SKU, UPC, location, or description"
      />
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
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-muted-foreground">
                No inventory matches.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
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

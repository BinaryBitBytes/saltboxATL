"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { InventoryRow } from "@/lib/inventory-schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { ScanInput } from "@/frontend/client/scan-input";
import { ProductCodes } from "@/frontend/client/product-codes";
import { matchesScan } from "@/lib/scan-code";

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

export function InventoryTable({
  initialRows,
  selectedItemId,
  onSelectItem,
}: {
  initialRows: InventoryRow[];
  selectedItemId?: string;
  onSelectItem?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [codesFor, setCodesFor] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
    initialData: initialRows,
  });

  useEffect(() => {
    queryClient.setQueryData(["inventory"], initialRows);
  }, [initialRows, queryClient]);

  const filtered = useMemo(() => {
    const rows = inventoryQuery.data ?? EMPTY_ROWS;
    const needle = query.trim();
    if (!needle) return rows;
    return rows.filter((row) =>
      matchesScan(row, { raw: needle, sku: needle, upc: needle }) ||
      [row.description, row.locationCode, row.roomName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle.toLowerCase()),
    );
  }, [inventoryQuery.data, query]);

  const table = useTable({
    features,
    columns,
    data: filtered,
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;
  const selectedRow = (inventoryQuery.data ?? EMPTY_ROWS).find(
    (row) => row.id === (codesFor || selectedItemId),
  );

  return (
    <div className="grid gap-3">
      <ScanInput
        onScan={(payload) => {
          const next = payload.upc || payload.sku || payload.raw;
          setQuery(next);
          const match = (inventoryQuery.data ?? EMPTY_ROWS).find((row) =>
            matchesScan(row, payload),
          );
          if (match) onSelectItem?.(match.id);
        }}
        placeholder="Scan barcode/QR or search SKU, UPC, location"
      />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter inventory"
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
              <TableHead>Codes</TableHead>
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="text-muted-foreground">
                No inventory matches.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={selectedItemId === row.id ? "selected" : undefined}
                onClick={() => onSelectItem?.(row.id)}
                className="cursor-pointer"
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCodesFor((current) =>
                        current === row.id ? null : row.id,
                      );
                    }}
                  >
                    {codesFor === row.id ? "Hide" : "Show"}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {selectedRow ? (
        <ProductCodes
          sku={selectedRow.sku}
          upc={selectedRow.upc}
          batch={selectedRow.batch}
        />
      ) : null}
    </div>
  );
}

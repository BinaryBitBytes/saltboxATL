"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileExportIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/frontend/client/field";
import { ScanInput } from "@/frontend/client/scan-input";
import { PrintDocument } from "@/frontend/client/print-document";
import {
  hasReportFilters,
  itemReportToCsv,
  queryItemReport,
  type ItemReportFilters,
  type ItemReportRow,
} from "@/lib/reports/item-report";
import type { InventoryCountReport } from "@/lib/inventory/count-math";
import { formatDateTime } from "@/lib/format";
import { LIMITS } from "@/lib/validation/limits";
import type { ScanPayload } from "@/lib/scan-code";

const EMPTY_FILTERS: ItemReportFilters = {
  sku: "",
  upc: "",
  poNumber: "",
  location: "",
  description: "",
};

function SourceBadge({ source }: { source: ItemReportRow["source"] }) {
  if (source === "on-hand") return <Badge>on hand</Badge>;
  if (source === "inbound") return <Badge variant="secondary">inbound</Badge>;
  return <Badge variant="outline">outbound</Badge>;
}

export function ReportWorkspace({
  catalog,
  count,
}: {
  catalog: ItemReportRow[];
  count: InventoryCountReport;
}) {
  const [filters, setFilters] = useState<ItemReportFilters>(EMPTY_FILTERS);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const report = useMemo(
    () => queryItemReport(catalog, filters),
    [catalog, filters],
  );
  const ready = hasReportFilters(filters);

  function setField(key: keyof ItemReportFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setGeneratedAt(new Date().toISOString());
  }

  function applyScan(payload: ScanPayload) {
    setGeneratedAt(new Date().toISOString());
    setFilters((current) => {
      if (payload.locationCode) {
        return { ...current, location: payload.locationCode };
      }
      return {
        ...current,
        sku: payload.sku || current.sku,
        upc: payload.upc || current.upc,
        description:
          payload.sku || payload.upc ? current.description : payload.raw,
      };
    });
  }

  function downloadCsv() {
    const csv = itemReportToCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `saltbox-item-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6">
      <InventoryCountCard count={count} />
      <Card>
        <CardHeader>
          <CardTitle>Query items</CardTitle>
          <CardDescription>
            Search SKU, UPC, PO, location, or description. Combined filters
            narrow the report.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ScanInput
            onScan={applyScan}
            placeholder="Scan an item or location to fill the matching field"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Item / SKU" htmlFor="report-sku">
              <Input
                id="report-sku"
                value={filters.sku ?? ""}
                maxLength={LIMITS.sku}
                placeholder="FBR-LC-12-100"
                onChange={(event) => setField("sku", event.target.value)}
              />
            </Field>
            <Field label="UPC" htmlFor="report-upc">
              <Input
                id="report-upc"
                value={filters.upc ?? ""}
                maxLength={LIMITS.upc}
                placeholder="010000000001"
                onChange={(event) => setField("upc", event.target.value)}
              />
            </Field>
            <Field label="PO" htmlFor="report-po">
              <Input
                id="report-po"
                value={filters.poNumber ?? ""}
                maxLength={LIMITS.text}
                placeholder="PO-88"
                onChange={(event) => setField("poNumber", event.target.value)}
              />
            </Field>
            <Field label="Location" htmlFor="report-location">
              <Input
                id="report-location"
                value={filters.location ?? ""}
                maxLength={LIMITS.code}
                placeholder="A-01-01 or Fiber Room"
                onChange={(event) => setField("location", event.target.value)}
              />
            </Field>
            <Field label="Description" htmlFor="report-description" className="sm:col-span-2">
              <Input
                id="report-description"
                value={filters.description ?? ""}
                maxLength={LIMITS.description}
                placeholder="fiber, crushed carton, Cat6…"
                onChange={(event) => setField("description", event.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setGeneratedAt(null);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {!ready ? (
        <p className="text-sm text-muted-foreground">
          Enter at least one query to generate an item report.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-sm text-muted-foreground">
              {countSummary(report.totals)}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={report.rows.length === 0}
              onClick={downloadCsv}
            >
              <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />
              Download CSV
            </Button>
          </div>

          <PrintDocument
            id="item-report"
            title="Item report"
            description="Print the current query as a warehouse item report."
            buttonLabel={
              report.rows.length === 0
                ? "Print report"
                : `Print ${report.rows.length} line${report.rows.length === 1 ? "" : "s"}`
            }
          >
            <article className="grid gap-4 text-sm text-black">
              <header className="border-b border-black pb-3">
                <p className="text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
                  Saltbox · Item report
                </p>
                <h2 className="mt-1 font-heading text-xl font-semibold">
                  Queried inventory
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  {generatedAt ? formatDateTime(generatedAt) : formatDateTime(new Date().toISOString())}
                  {" · "}
                  {filterSummary(report.filters)}
                </p>
                <p className="mt-1 text-xs">
                  {countSummary(report.totals)}
                </p>
              </header>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-1 font-semibold">SKU</th>
                    <th className="py-1 font-semibold">UPC</th>
                    <th className="py-1 font-semibold">Description</th>
                    <th className="py-1 font-semibold">Manufacturer</th>
                    <th className="py-1 font-semibold">Color</th>
                    <th className="py-1 font-semibold">Location</th>
                    <th className="py-1 font-semibold">Source</th>
                    <th className="py-1 text-right font-semibold">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr>
                      <td className="py-3 text-neutral-600" colSpan={8}>
                        No items matched that query.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row) => (
                      <tr key={row.id} className="border-b border-neutral-300">
                        <td className="py-1.5 font-medium">{row.sku}</td>
                        <td className="py-1.5">{row.upc || "—"}</td>
                        <td className="py-1.5">{row.description}</td>
                        <td className="py-1.5">{row.manufacturer || "—"}</td>
                        <td className="py-1.5">{row.color || "—"}</td>
                        <td className="py-1.5">
                          {row.roomName} / {row.locationCode}
                        </td>
                        <td className="py-1.5">{row.sourceLabel}</td>
                        <td className="py-1.5 text-right">{row.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </article>
          </PrintDocument>

          <div className="overflow-x-auto print:hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>UPC</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Manufacturer</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground">
                      No items matched that query.
                    </TableCell>
                  </TableRow>
                ) : (
                  report.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.sku}</div>
                        {row.batch ? (
                          <div className="text-xs text-muted-foreground">
                            Batch {row.batch}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.upc || "—"}</TableCell>
                      <TableCell>{row.description}</TableCell>
                      <TableCell>{row.manufacturer || "—"}</TableCell>
                      <TableCell>{row.color || "—"}</TableCell>
                      <TableCell>
                        {row.roomName} / {row.locationCode}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <SourceBadge source={row.source} />
                          <span className="text-xs text-muted-foreground">
                            {row.sourceLabel}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function countSummary(totals: {
  lines: number;
  skus: number;
  onHandUnits: number;
  awaitingPutawayUnits: number;
  shippedUnits: number;
}): string {
  return [
    `${totals.lines} line${totals.lines === 1 ? "" : "s"}`,
    `${totals.skus} SKU${totals.skus === 1 ? "" : "s"}`,
    `On hand ${totals.onHandUnits}`,
    `Awaiting putaway ${totals.awaitingPutawayUnits}`,
    `Shipped ${totals.shippedUnits}`,
  ].join(" · ");
}

function InventoryCountCard({ count }: { count: InventoryCountReport }) {
  const figures = [
    ["On hand", count.onHand],
    ["Overage", count.movements.overage],
    ["Shortage", count.movements.shortage],
    ["Damage write-off", -count.movements.damageWriteOff],
    ["Damage moved", count.movements.damageMoved],
    ["Import", count.movements.import],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory count</CardTitle>
        <CardDescription>
          On-hand quantity checked against overage, shortage, damage, and
          import transactions. Each movement must end at its starting quantity
          plus its delta, and the last movement must match the quantity still
          on hand.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {figures.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold tabular-nums">
                {label === "On hand" || label === "Damage moved" ? value : formatSigned(value)}
              </p>
            </div>
          ))}
        </div>
        <p className="text-sm">
          {count.balanced
            ? "Transaction math matches on-hand inventory."
            : `${count.discrepancies.length} count ${count.discrepancies.length === 1 ? "discrepancy" : "discrepancies"}.`}
        </p>
        {count.discrepancies.length > 0 ? (
          <ul className="grid gap-1 text-sm text-destructive">
            {count.discrepancies.slice(0, 8).map((entry) => (
              <li key={`${entry.transactionId ?? entry.inventoryItemId}-${entry.message}`}>
                {entry.message}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function filterSummary(filters: ItemReportFilters): string {
  const parts = [
    filters.sku ? `SKU ${filters.sku}` : null,
    filters.upc ? `UPC ${filters.upc}` : null,
    filters.poNumber ? `PO ${filters.poNumber}` : null,
    filters.location ? `Location ${filters.location}` : null,
    filters.description ? `Description “${filters.description}”` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "No filters";
}

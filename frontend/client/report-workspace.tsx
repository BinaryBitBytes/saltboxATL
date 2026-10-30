"use client";

import { T, useLocale, useT } from "@/frontend/client/language";
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
import { formatDateTime } from "@/lib/format";
import { FORCED_CUBE_LABEL, FORCED_CUBE_ROW_CLASS, isForcedCube } from "@/lib/cubing/forced-cube";
import { LIMITS } from "@/lib/validation/limits";
import type { ScanPayload } from "@/lib/scan-code";

const EMPTY_FILTERS: ItemReportFilters = {
  sku: "",
  upc: "",
  poNumber: "",
  jobIdNumber: "",
  location: "",
  description: "",
};

function SourceBadge({ source }: { source: ItemReportRow["source"] }) {
  if (source === "on-hand") return <Badge><T>on hand</T></Badge>;
  if (source === "inbound") return <Badge variant="secondary"><T>inbound</T></Badge>;
  return <Badge variant="outline"><T>outbound</T></Badge>;
}

export function ReportWorkspace({ catalog }: { catalog: ItemReportRow[] }) {
  const locale = useLocale();
  const t = useT();
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
      <Card>
        <CardHeader>
          <CardTitle><T>Query items</T></CardTitle>
          <CardDescription><T>Search SKU, UPC, PO, job ID, location, or description. Combined filters narrow the report.</T></CardDescription>
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
            <Field label="Job ID" htmlFor="report-job-id">
              <Input
                id="report-job-id"
                value={filters.jobIdNumber ?? ""}
                maxLength={LIMITS.code}
                placeholder="JOB-1042"
                onChange={(event) => setField("jobIdNumber", event.target.value)}
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
        <p className="text-sm text-muted-foreground"><T>Enter at least one query to generate an item report.</T></p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p className="text-sm text-muted-foreground">
              {report.totals.lines} line{report.totals.lines === 1 ? "" : "s"} ·{" "}
              {report.totals.skus} SKU{report.totals.skus === 1 ? "" : "s"} ·{" "}
              {report.totals.units} unit{report.totals.units === 1 ? "" : "s"}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={report.rows.length === 0}
              onClick={downloadCsv}
            >
              <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} /><T>Download CSV</T></Button>
          </div>

          <PrintDocument
            id="item-report"
            title="Item report"
            description="Print the current query as a warehouse item report."
            buttonLabel={
              report.rows.length === 1
                ? t("Print {{count}} line", { count: report.rows.length })
                : report.rows.length === 0
                  ? t("Print report")
                  : t("Print {{count}} lines", { count: report.rows.length })
            }
          >
            <article className="grid gap-4 text-sm text-black">
              <header className="border-b border-black pb-3">
                <p className="text-[0.65rem] font-semibold tracking-[0.16em] uppercase"><T>Saltbox · Item report</T></p>
                <h2 className="mt-1 font-heading text-xl font-semibold"><T>Queried inventory</T></h2>
                <p className="mt-1 text-xs text-neutral-600">
                  {generatedAt ? formatDateTime(generatedAt, locale) : formatDateTime(new Date().toISOString(), locale)}
                  {" · "}
                  {filterSummary(report.filters)}
                </p>
                <p className="mt-1 text-xs">
                  {report.totals.lines} line{report.totals.lines === 1 ? "" : "s"} ·{" "}
                  {report.totals.skus} SKU{report.totals.skus === 1 ? "" : "s"} ·{" "}
                  {report.totals.units} unit{report.totals.units === 1 ? "" : "s"}
                </p>
              </header>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-1 font-semibold">SKU</th>
                    <th className="py-1 font-semibold">UPC</th>
                    <th className="py-1 font-semibold"><T>Description</T></th>
                    <th className="py-1 font-semibold"><T>Manufacturer</T></th>
                    <th className="py-1 font-semibold"><T>Color</T></th>
                    <th className="py-1 font-semibold"><T>Location</T></th>
                    <th className="py-1 font-semibold"><T>Source</T></th>
                    <th className="py-1 font-semibold"><T>Job ID</T></th>
                    <th className="py-1 text-right font-semibold"><T>Qty</T></th>
                    <th className="py-1 font-semibold"><T>Cube</T></th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr>
                      <td className="py-3 text-neutral-600" colSpan={10}><T>No items matched that query.</T></td>
                    </tr>
                  ) : (
                    report.rows.map((row) => (
                      <tr
                        key={row.id}
                        data-cube-forced={isForcedCube(row) ? "true" : undefined}
                        className={
                          isForcedCube(row)
                            ? "border-b border-neutral-300 bg-neutral-200 font-semibold"
                            : "border-b border-neutral-300"
                        }
                      >
                        <td className="py-1.5 font-medium">{row.sku}</td>
                        <td className="py-1.5">{row.upc || "—"}</td>
                        <td className="py-1.5">{row.description}</td>
                        <td className="py-1.5">{row.manufacturer || "—"}</td>
                        <td className="py-1.5">{row.color || "—"}</td>
                        <td className="py-1.5">
                          {row.roomName} / {row.locationCode}
                        </td>
                        <td className="py-1.5">{row.sourceLabel}</td>
                        <td className="py-1.5">{row.jobIdNumber || "—"}</td>
                        <td className="py-1.5 text-right">{row.quantity}</td>
                        <td className="py-1.5">{isForcedCube(row) ? FORCED_CUBE_LABEL : ""}</td>
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
                  <TableHead><T>Description</T></TableHead>
                  <TableHead><T>Manufacturer</T></TableHead>
                  <TableHead><T>Color</T></TableHead>
                  <TableHead><T>Location</T></TableHead>
                  <TableHead><T>Source</T></TableHead>
                  <TableHead><T>Job ID</T></TableHead>
                  <TableHead className="text-right"><T>Qty</T></TableHead>
                  <TableHead><T>Cube</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-muted-foreground"><T>No items matched that query.</T></TableCell>
                  </TableRow>
                ) : (
                  report.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-cube-forced={isForcedCube(row) ? "true" : undefined}
                      className={isForcedCube(row) ? FORCED_CUBE_ROW_CLASS : undefined}
                    >
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
                      <TableCell>{row.jobIdNumber || "—"}</TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                      <TableCell>
                        {isForcedCube(row) ? (
                          <Badge variant="destructive"><T>{FORCED_CUBE_LABEL}</T></Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
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

function filterSummary(filters: ItemReportFilters): string {
  const parts = [
    filters.sku ? `SKU ${filters.sku}` : null,
    filters.upc ? `UPC ${filters.upc}` : null,
    filters.poNumber ? `PO ${filters.poNumber}` : null,
    filters.jobIdNumber ? `Job ${filters.jobIdNumber}` : null,
    filters.location ? `Location ${filters.location}` : null,
    filters.description ? `Description “${filters.description}”` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "No filters";
}

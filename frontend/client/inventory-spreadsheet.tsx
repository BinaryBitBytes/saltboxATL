"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileExportIcon, FileImportIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { cn } from "@/lib/utils";
import {
  importInventoryForm,
  type ActionResult,
} from "@/backend/server/serverAction";

type ImportData = {
  dryRun: boolean;
  applied: boolean;
  created: number;
  updated: number;
  unchanged: number;
  unitsDelta: number;
  rowsRead: number;
  requiresConfirmation: boolean;
  errors: Array<{ row: number; message: string }>;
  sourceText?: string;
};

export function InventorySpreadsheetCard({
  canImport = false,
}: {
  canImport?: boolean;
}) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState(
    importInventoryForm,
    null as ActionResult<ImportData> | null,
  );
  const result = state?.ok ? state.data : null;
  const error = state && !state.ok ? state.error : null;
  const confirmationTotal = Math.abs(result?.unitsDelta ?? 0);

  useEffect(() => {
    if (!result?.applied) return;
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
  }, [queryClient, result?.applied]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spreadsheet import & export</CardTitle>
        <CardDescription>
          Download on-hand inventory as a CSV spreadsheet for Excel or Google
          Sheets. Managers can import the same file to load or update existing
          stock. Location codes must already exist.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            render={<a href="/api/inventory/export" />}
            variant="outline"
          >
            <HugeiconsIcon icon={FileExportIcon} strokeWidth={2} />
            Export on-hand CSV
          </Button>
          <Button
            nativeButton={false}
            render={<a href="/api/inventory/export?template=1" />}
            variant="outline"
          >
            Download template
          </Button>
        </div>
        {canImport ? (
          <form action={formAction} className="grid gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Save workbooks as CSV UTF-8, or paste rows copied from Excel.
              Format SKU, UPC, and Location as text so leading zeros are kept.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="CSV file" htmlFor="inventory-spreadsheet">
                <input
                  id="inventory-spreadsheet"
                  name="file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  className={cn(
                    "h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 py-0.5 text-sm outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium",
                  )}
                />
              </Field>
              <Field label="Import mode" htmlFor="inventory-import-mode">
                <NativeSelect id="inventory-import-mode" name="mode" defaultValue="set">
                  <option value="set">Set on-hand quantities</option>
                  <option value="add">Add to existing quantities</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="Or paste CSV / Excel rows" htmlFor="inventory-spreadsheet-paste">
              <textarea
                id="inventory-spreadsheet-paste"
                name="text"
                rows={5}
                key={result?.sourceText ?? "blank"}
                defaultValue={result?.sourceText ?? ""}
                placeholder={"SKU,UPC,Description,Batch,Qty,Location\nPATCH-SM-100,010000000099,Patch panel,,7,A-01-02"}
                className={cn(
                  "flex min-h-16 w-full resize-y rounded-md border border-input bg-input/20 px-2 py-2 text-sm outline-none",
                )}
              />
            </Field>
            {result?.requiresConfirmation ? (
              <div className="grid gap-2 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  This spreadsheet unit change of {confirmationTotal} is large.
                  Check the box and re-enter {confirmationTotal} to import.
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="confirmLargeInput" value="1" />
                  I confirm this spreadsheet unit change is {confirmationTotal}
                </label>
                <Field label="Re-enter spreadsheet unit change" htmlFor="spreadsheet-confirm-qty">
                  <input
                    id="spreadsheet-confirm-qty"
                    name="confirmationQuantity"
                    type="number"
                    className="h-7 w-full rounded-md border border-input bg-input/20 px-2 text-sm"
                  />
                </Field>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="preview" variant="outline" disabled={pending}>
                {pending ? "Working…" : "Preview import"}
              </Button>
              <Button type="submit" name="intent" value="apply" disabled={pending}>
                <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
                Import spreadsheet
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {result ? <ImportSummary result={result} /> : null}
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Anyone who can view inventory can export. Managers import
            spreadsheets to integrate existing stock.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ImportSummary({ result }: { result: ImportData }) {
  return (
    <div className="grid gap-2 text-sm">
      <p>
        {result.applied ? "Imported" : "Preview"}: {result.created} created,{" "}
        {result.updated} updated, {result.unchanged} unchanged. Net units{" "}
        {result.unitsDelta > 0 ? "+" : ""}
        {result.unitsDelta}.
      </p>
      {result.errors.length > 0 ? (
        <ul className="grid gap-1 text-destructive">
          {result.errors.slice(0, 8).map((entry) => (
            <li key={`${entry.row}-${entry.message}`}>
              Row {entry.row}: {entry.message}
            </li>
          ))}
          {result.errors.length > 8 ? (
            <li>{result.errors.length - 8} more errors</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

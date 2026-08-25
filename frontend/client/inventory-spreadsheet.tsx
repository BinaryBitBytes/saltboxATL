"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileExportIcon, FileImportIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, NativeSelect } from "@/frontend/client/field";
import { LargeInputConfirm } from "@/frontend/client/large-input-confirm";
import type { SpreadsheetImportPlan } from "@/lib/inventory/spreadsheet";

type ImportResult = SpreadsheetImportPlan & {
  dryRun: boolean;
  applied: boolean;
};

export function InventorySpreadsheetCard({
  canImport = false,
}: {
  canImport?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"set" | "add">("set");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmLargeInput, setConfirmLargeInput] = useState(false);
  const [confirmationQuantity, setConfirmationQuantity] = useState<number | "">(
    "",
  );

  async function postImport(dryRun: boolean): Promise<ImportResult> {
    if (!file) {
      throw new Error("Choose a CSV spreadsheet to import.");
    }
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    form.set("dryRun", dryRun ? "1" : "0");
    if (confirmLargeInput) form.set("confirmLargeInput", "1");
    if (confirmationQuantity !== "") {
      form.set("confirmationQuantity", String(confirmationQuantity));
    }
    const response = await fetch("/api/inventory/import", {
      method: "POST",
      body: form,
    });
    const json = (await response.json()) as {
      success?: boolean;
      data?: ImportResult;
      error?: string;
    };
    if (!response.ok || !json.success || !json.data) {
      throw new Error(json.error || "Unable to import that spreadsheet.");
    }
    return json.data;
  }

  async function handlePreview() {
    setError(null);
    setPreview(null);
    setPending(true);
    try {
      const result = await postImport(true);
      setPreview(result);
      setConfirmLargeInput(false);
      setConfirmationQuantity("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleImport() {
    setError(null);
    setPending(true);
    try {
      const result = await postImport(false);
      setPreview(result);
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setPending(false);
    }
  }

  const confirmationTotal = Math.abs(preview?.unitsDelta ?? 0);
  const canApply =
    Boolean(preview) &&
    preview?.errors.length === 0 &&
    ((preview?.created ?? 0) > 0 || (preview?.updated ?? 0) > 0);

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
          <div className="grid gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Save workbooks as CSV UTF-8. Format SKU, UPC, and Location as
              text so Excel does not drop leading zeros.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="CSV file" htmlFor="inventory-spreadsheet">
                <Input
                  id="inventory-spreadsheet"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setError(null);
                  }}
                />
              </Field>
              <Field label="Import mode" htmlFor="inventory-import-mode">
                <NativeSelect
                  id="inventory-import-mode"
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as "set" | "add");
                    setPreview(null);
                  }}
                >
                  <option value="set">Set on-hand quantities</option>
                  <option value="add">Add to existing quantities</option>
                </NativeSelect>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!file || pending}
                onClick={() => void handlePreview()}
              >
                Preview import
              </Button>
              <Button
                type="button"
                disabled={!canApply || pending}
                onClick={() => void handleImport()}
              >
                <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />
                {pending ? "Working…" : "Import spreadsheet"}
              </Button>
            </div>
            {preview?.requiresConfirmation && canApply ? (
              <LargeInputConfirm
                total={confirmationTotal}
                label="spreadsheet unit change"
                confirmed={confirmLargeInput}
                onConfirmedChange={setConfirmLargeInput}
                confirmationQuantity={confirmationQuantity}
                onConfirmationQuantityChange={setConfirmationQuantity}
              />
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {preview ? <ImportSummary result={preview} /> : null}
          </div>
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

function ImportSummary({ result }: { result: ImportResult }) {
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
          {result.errors.slice(0, 8).map((error) => (
            <li key={`${error.row}-${error.message}`}>
              Row {error.row}: {error.message}
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

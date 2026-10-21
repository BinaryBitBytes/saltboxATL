import { FormattedDate, T } from "@/frontend/client/language";
import {
  InboundPoActions,
  type InboundPoDraft,
} from "@/frontend/client/inbound-po-actions";
import { getSystem } from "@/backend/server/store";
import { requirePermission } from "@/backend/server/dal";
import { hasPermission } from "@/lib/auth/permissions";
import {
  buildInboundForecast,
  inboundStatusLabel,
} from "@/lib/inbound/forecast";

import { formatJobId } from "@/lib/purchase-orders";
import type { PurchaseOrder } from "@/lib/inventory-schema";
import { InboundCapture } from "@/frontend/client/inbound-capture";
import { PurchaseDocumentActions } from "@/frontend/client/purchase-document-actions";
import { JobIdEditor } from "@/frontend/client/job-id-editor";
import { purchaseDocumentView } from "@/lib/documents/view";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function InboundPage() {
  const user = await requirePermission("viewInboundForecast");
  const system = await getSystem();
  const forecast = buildInboundForecast(
    system.purchaseOrders,
    system.receivingOrders,
  );
  const canUpload = hasPermission(user.role, "uploadBuyerOrders");
  const canAssign = hasPermission(user.role, "assignJobId");
  const canOpenPdf = hasPermission(user.role, "viewPurchaseDocuments");
  const canSeePrices = canUpload || canOpenPdf;
  const documents = system.purchaseDocuments ?? [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold"><T>Inbound forecast</T></h1>
        <p className="text-sm text-muted-foreground"><T>Buyer purchase orders describe the carrier, vendor, and lines expected before the dock receives them. Project managers assign the internal job ID. Warehouse roles can read this board and cannot change it.</T></p>
        <p className="text-sm text-muted-foreground"><T>The PDF file is saved for project managers.</T></p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Upcoming POs" value={String(forecast.upcomingCount)} />
        <Stat label="Expected units" value={String(forecast.upcomingUnits)} />
        <Stat label="Awaiting job ID" value={String(forecast.awaitingJobId)} />
        <Stat label="Carriers" value={String(forecast.byCarrier.length)} />
      </div>

      {forecast.byCarrier.length > 0 || forecast.byVendor.length > 0 ? (
        <div className="grid gap-4 min-[56rem]:grid-cols-2">
          <GroupCard
            title="By carrier"
            empty="No upcoming freight by carrier."
            rows={forecast.byCarrier.map((entry) => ({
              label: entry.carrier,
              detail: `${entry.orders} PO${entry.orders === 1 ? "" : "s"} · ${entry.units} units`,
            }))}
          />
          <GroupCard
            title="By vendor"
            empty="No upcoming freight by vendor."
            rows={forecast.byVendor.map((entry) => ({
              label: entry.vendor,
              detail: `${entry.orders} PO${entry.orders === 1 ? "" : "s"} · ${entry.units} units`,
            }))}
          />
        </div>
      ) : null}

      {canUpload ? <InboundCapture /> : null}

      <div className="grid gap-3">
        {forecast.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground"><T>No buyer purchase orders have been uploaded yet.</T></p>
        ) : (
          forecast.rows.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>PO {row.purchaseOrderNumber}</CardTitle>
                    <CardDescription>
                      {row.vendor} · {row.carrier}
                      {row.projectId ? ` · Project ${row.projectId}` : ""}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{inboundStatusLabel(row.derivedStatus)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail
                    label="Expected arrival"
                    value={<FormattedDate value={row.expectedArrivalAt ?? undefined} />}
                  />
                  <Detail label="Buyer" value={row.buyerName || "—"} />
                  <Detail
                    label="Expected pallets"
                    value={String(row.expectedPalletCount)}
                  />
                  <Detail
                    label="Units expected / received"
                    value={`${row.expectedUnits} / ${row.receivedUnits}`}
                  />
                </div>
                {canUpload ? (
                  <InboundPoActions
                    order={inboundDraft(
                      system.purchaseOrders.find((order) => order.id === row.id),
                      row,
                    )}
                  />
                ) : null}
                {canAssign ? (
                  <JobIdEditor
                    purchaseOrderNumber={row.purchaseOrderNumber}
                    jobIdNumber={row.jobIdNumber}
                  />
                ) : (
                  <Detail label="Job ID" value={formatJobId(row.jobIdNumber)} />
                )}
                {row.notes ? <p>{row.notes}</p> : null}
                {documents
                  .filter((document) => document.purchaseOrderNumber === row.purchaseOrderNumber)
                  .map((document) => (
                    <PurchaseDocumentActions
                      key={document.id}
                      document={purchaseDocumentView(document, {
                        canOpenFile: canOpenPdf,
                        canUpload,
                        canSeePrices,
                      })}
                    />
                  ))}
                {row.lines.length > 0 ? (
                  <ul className="grid gap-1 text-muted-foreground">
                    {row.lines.map((line, index) => (
                      <li key={`${row.id}-${index}`}>
                        {line.sku || "No SKU"}
                        {line.description ? ` · ${line.description}` : ""} · expected{" "}
                        {line.quantity}
                        {line.sku ? ` · received ${line.receivedQuantity}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function inboundDraft(
  order: PurchaseOrder | undefined,
  row: {
    id: string;
    purchaseOrderNumber: string;
    projectId: string | null;
    jobIdNumber: string | null;
    vendor: string;
    carrier: string;
    expectedArrivalAt: string | null;
    buyerName: string | null;
    notes: string;
    expectedPalletCount: number;
    lines: Array<{ sku: string; upc: string; description: string; quantity: number }>;
  },
): InboundPoDraft {
  return {
    id: order?.id ?? row.id,
    purchaseOrderNumber: order?.purchaseOrderNumber ?? row.purchaseOrderNumber,
    projectId: order?.projectId ?? row.projectId ?? "",
    jobIdNumber: order?.jobIdNumber ?? row.jobIdNumber ?? "",
    vendor: order?.vendor ?? row.vendor,
    carrier: order?.carrier ?? row.carrier,
    expectedArrivalAt: order?.expectedArrivalAt ?? row.expectedArrivalAt ?? "",
    buyerName: order?.buyerName ?? row.buyerName ?? "",
    notes: order?.expectationNotes ?? row.notes,
    expectationStatus: order?.expectationStatus ?? "expected",
    expectedPalletCount: order?.expectedPalletCount ?? row.expectedPalletCount,
    lines: (order?.lines ?? row.lines).map((line) => ({
      sku: line.sku,
      upc: line.upc,
      description: line.description,
      quantity: line.quantity,
    })),
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl sm:text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: import("react").ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        <T>{label}</T>
      </p>
      <p>{value}</p>
    </div>
  );
}

function GroupCard({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ label: string; detail: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">
            <T>{empty}</T>
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 text-muted-foreground">{row.detail}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

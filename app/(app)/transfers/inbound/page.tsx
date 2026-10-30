import { T } from "@/frontend/client/language";
import { requirePermission } from "@/backend/server/dal";
import { resolveViewerSite } from "@/backend/server/site-context";
import { readDivisionInventory } from "@/backend/server/store";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LabelPrintSheet } from "@/frontend/client/label-sheet";
import { InboundTransferForm } from "@/frontend/client/transfer-forms";
import { buildInboundTransferLabels } from "@/lib/transfers/labels";
import { lineOpenQuantity, transferUnitBalance } from "@/lib/transfers/math";

export default async function InboundTransfersPage() {
  await requirePermission("transferFreight");
  const viewer = await resolveViewerSite();
  const system = await readDivisionInventory();
  const transfers = (system.facilityTransfers ?? []).filter(
    (transfer) => transfer.destinationSiteId === viewer.siteId,
  );
  const formTransfers = transfers.map((transfer) => {
    const balance = transferUnitBalance(transfer);
    return {
      id: transfer.id,
      trailerCode: transfer.trailerCode,
      sourceNomenclature: transfer.sourceNomenclature,
      destinationNomenclature: transfer.destinationNomenclature,
      inTransitUnits: balance.inTransit,
      lines: transfer.lines.map((line) => ({
        id: line.id,
        sku: line.sku,
        description: line.description,
        quantityLoaded: line.quantityLoaded,
        quantityReceived: line.quantityReceived,
        openQuantity: lineOpenQuantity(line),
      })),
    };
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          <T>Inbound Transfers</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Verify the receipt from the transfer trailer. Freight is then routed into this facility and new labels print with the route, item barcode, QR code, and a license plate for this facility.
          </T>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Verify receipt</T>
          </CardTitle>
          <CardDescription>
            <T>Received units cannot exceed the freight still on the trailer. Routing splits the receipt across open locations.</T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InboundTransferForm
            key={formTransfers.map((transfer) => `${transfer.id}:${transfer.inTransitUnits}`).join("|")}
            transfers={formTransfers}
          />
        </CardContent>
      </Card>

      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No inbound transfer trailers are waiting at this facility.</T>
        </p>
      ) : (
        transfers.map((transfer) => {
          const balance = transferUnitBalance(transfer);
          const labels = buildInboundTransferLabels(transfer);
          return (
            <Card key={transfer.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {transfer.trailerCode}
                  <Badge variant="outline">{transfer.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {transfer.sourceNomenclature} → {transfer.destinationNomenclature}
                  {" · "}
                  <T>Loaded</T> {balance.loaded}
                  {" · "}
                  <T>Received</T> {balance.received}
                  {" · "}
                  <T>In transit</T> {balance.inTransit}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LabelPrintSheet
                  title={`${transfer.trailerCode} routing labels`}
                  description={`${balance.received} received · ${balance.inTransit} still on the trailer`}
                  labels={labels}
                  printId={`inbound-${transfer.id}`}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

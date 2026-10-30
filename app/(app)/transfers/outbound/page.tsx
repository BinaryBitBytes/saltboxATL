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
import { OutboundTransferForm } from "@/frontend/client/transfer-forms";
import { locationSiteId, siteLabel } from "@/lib/sites/database";
import { nextTrailerCode } from "@/lib/transfers/facility";
import { buildOutboundTransferLabels } from "@/lib/transfers/labels";
import { transferUnitBalance } from "@/lib/transfers/math";

export default async function OutboundTransfersPage() {
  await requirePermission("transferFreight");
  const viewer = await resolveViewerSite();
  const system = await readDivisionInventory();
  const stock = system.inventoryItems
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const location = system.locations.find((entry) => entry.id === item.locationId);
      const siteId = location ? locationSiteId(system, location) : null;
      if (!location || siteId !== viewer.siteId) return null;
      return {
        inventoryItemId: item.id,
        locationCode: location.code,
        sku: item.sku,
        quantity: item.quantity,
        description: item.description ?? item.sku,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.sku.localeCompare(right.sku));
  const destinations = (system.sites ?? [])
    .filter((site) => site.id !== viewer.siteId)
    .map((site) => ({
      id: site.id,
      nomenclature: site.codename,
      label: siteLabel(site),
    }))
    .sort((left, right) => left.nomenclature.localeCompare(right.nomenclature));
  const transfers = (system.facilityTransfers ?? []).filter(
    (transfer) => transfer.sourceSiteId === viewer.siteId,
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          <T>Outbound Transfers</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Load freight onto a transfer trailer headed to another facility. The tag prints a barcode and QR code for the item, the destination nomenclature, and a license plate for this outbound facility.
          </T>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Load trailer</T>
          </CardTitle>
          <CardDescription>
            <T>On-hand stock leaves this facility and rides the trailer until the destination verifies the receipt.</T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OutboundTransferForm
            key={nextTrailerCode(system)}
            stock={stock}
            destinations={destinations}
            suggestedTrailer={nextTrailerCode(system)}
          />
        </CardContent>
      </Card>

      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No outbound transfers yet.</T>
        </p>
      ) : (
        transfers.map((transfer) => {
          const balance = transferUnitBalance(transfer);
          const labels = buildOutboundTransferLabels(transfer);
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
              <CardContent className="grid gap-4">
                <LabelPrintSheet
                  title={`${transfer.trailerCode} labels`}
                  description={`${transfer.destinationNomenclature} · ${balance.loaded} units`}
                  labels={labels}
                  printId={`outbound-${transfer.id}`}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

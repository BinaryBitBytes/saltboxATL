import { T } from "@/frontend/client/language";
import { getTranslator } from "@/lib/i18n/server";
import { requirePermission } from "@/backend/server/dal";
import { readMultiSiteSystem } from "@/backend/server/store";
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
import { SiteTransferForm } from "@/frontend/client/site-transfer-form";
import { WarehouseTree } from "@/frontend/client/warehouse-tree";
import { hasPermission } from "@/lib/auth/permissions";
import { logisticsOptimization, siteInsights } from "@/lib/sites/insight";
import { buildWarehouseTree, locationSiteId, siteLabel } from "@/lib/sites/database";

export default async function SiteNetworkPage() {
  const { t } = await getTranslator();
  const user = await requirePermission("viewSiteNetwork");
  const system = await readMultiSiteSystem();
  const insights = siteInsights(system);
  const optimization = logisticsOptimization(system);
  const tree = buildWarehouseTree(system);
  const canTransfer = hasPermission(user.role, "transferBetweenSites");
  const canOptimize = hasPermission(user.role, "optimizeLogistics");
  const labels = new Map((system.sites ?? []).map((site) => [site.id, siteLabel(site)]));
  const sources = system.inventoryItems
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const location = system.locations.find((entry) => entry.id === item.locationId);
      const siteId = location ? locationSiteId(system, location) : null;
      if (!location || !siteId) return null;
      return {
        inventoryItemId: item.id,
        siteId,
        siteLabel: labels.get(siteId) ?? siteId,
        locationId: location.id,
        locationCode: location.code,
        sku: item.sku,
        quantity: item.quantity,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.sku.localeCompare(right.sku));
  const destinations = system.locations
    .filter((location) => location.isActive)
    .map((location) => {
      const siteId = locationSiteId(system, location);
      if (!siteId) return null;
      return {
        locationId: location.id,
        siteId,
        siteLabel: labels.get(siteId) ?? siteId,
        locationCode: location.code,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.locationCode.localeCompare(right.locationCode));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          <T>Site network</T>
        </h1>
        <p className="text-sm text-muted-foreground">
          <T>
            Each work site keeps its own inventory database. This view is the cross-site picture: on-hand insight, logistical flow, and site-to-site transfers.
          </T>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Inventory insight</T>
          </CardTitle>
          <CardDescription>
            <T>On-hand stock stays inside the database for that site.</T>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><T>Work site</T></TableHead>
                <TableHead><T>Database</T></TableHead>
                <TableHead><T>SKUs</T></TableHead>
                <TableHead><T>Units</T></TableHead>
                <TableHead><T>Locations</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {insights.map((insight) => (
                <TableRow key={insight.siteId}>
                  <TableCell>{insight.label}</TableCell>
                  <TableCell className="font-mono text-xs">{insight.databaseName}</TableCell>
                  <TableCell>{insight.skuCount}</TableCell>
                  <TableCell>{insight.units}</TableCell>
                  <TableCell>
                    {insight.occupiedLocations}/{insight.locationCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {insights.map((insight) => (
            <div key={`${insight.siteId}-skus`} className="grid gap-1">
              <h3 className="text-xs font-medium">{insight.codename}</h3>
              <p className="text-xs text-muted-foreground">
                {insight.skus.length === 0 ? (
                  <T>No on-hand stock in this database.</T>
                ) : (
                  insight.skus.map((sku) => `${sku.sku} ${sku.quantity}`).join(" · ")
                )}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {canOptimize ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <T>Logistical flow</T>
            </CardTitle>
            <CardDescription>
              <T>Optimization components across the work sites you can view.</T>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <section className="grid gap-1">
              <h3 className="text-sm font-medium">
                <T>On-hand balance</T>
              </h3>
              <p className="text-sm text-muted-foreground">
                {optimization.sharedSkuCount === 1
                  ? t("1 SKU is stocked at more than one work site.")
                  : t("{{count}} SKUs are stocked at more than one work site.", {
                      count: optimization.sharedSkuCount,
                    })}
              </p>
              {optimization.suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <T>No rebalance is suggested.</T>
                </p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {optimization.suggestions.map((suggestion) => (
                    <li key={`${suggestion.sku}-${suggestion.toSiteId}`}>
                      {t("Move {{quantity}} {{sku}} from {{from}} to {{to}}.", {
                        quantity: suggestion.quantity,
                        sku: suggestion.sku,
                        from: suggestion.fromLabel,
                        to: suggestion.toLabel,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="grid gap-1">
              <h3 className="text-sm font-medium">
                <T>Location occupancy</T>
              </h3>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {optimization.occupancy.map((row) => (
                  <li key={row.siteId}>
                    {row.label}: {row.occupied}/{row.total}
                  </li>
                ))}
              </ul>
            </section>
            <section className="grid gap-1">
              <h3 className="text-sm font-medium">
                <T>Zone velocity</T>
              </h3>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {optimization.velocity.map((row) => (
                  <li key={row.siteId}>
                    {row.label}: <T>fast inbound</T> {row.fastInbound}, <T>slow outbound</T>{" "}
                    {row.slowOutbound}
                    {row.tight ? (
                      <>
                        . <T>Inbound flow is tight because the site is nearly full.</T>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </CardContent>
        </Card>
      ) : null}

      {canTransfer ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <T>Order a site transfer</T>
            </CardTitle>
            <CardDescription>
              <T>Move on-hand stock from one site database into another.</T>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SiteTransferForm sources={sources} destinations={destinations} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <T>Warehouse hierarchy</T>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseTree nodes={tree} heading={false} />
        </CardContent>
      </Card>
    </div>
  );
}

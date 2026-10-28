import type { InventorySystem } from "@/lib/inventory-schema";
import { locationSiteId, siteDatabaseName, siteLabel } from "@/lib/sites/database";

export type SiteInsight = {
  siteId: string;
  databaseName: string;
  label: string;
  codename: string;
  units: number;
  skuCount: number;
  locationCount: number;
  occupiedLocations: number;
  skus: Array<{ sku: string; description: string; quantity: number }>;
};

export type TransferSuggestion = {
  sku: string;
  description: string;
  fromSiteId: string;
  toSiteId: string;
  fromLabel: string;
  toLabel: string;
  quantity: number;
};

export type OccupancyRow = {
  siteId: string;
  label: string;
  occupied: number;
  total: number;
};

export type VelocityRow = {
  siteId: string;
  label: string;
  fastInbound: number;
  slowOutbound: number;
  tight: boolean;
};

export type LogisticsOptimization = {
  sharedSkuCount: number;
  suggestions: TransferSuggestion[];
  occupancy: OccupancyRow[];
  velocity: VelocityRow[];
};

export function siteInsights(system: InventorySystem): SiteInsight[] {
  return [...(system.sites ?? [])]
    .sort((left, right) => left.codename.localeCompare(right.codename))
    .map((site) => {
      const locationIds = new Set(
        (system.locations ?? [])
          .filter((location) => locationSiteId(system, location) === site.id)
          .map((location) => location.id),
      );
      const items = (system.inventoryItems ?? []).filter((item) =>
        locationIds.has(item.locationId),
      );
      const bySku = new Map<string, { sku: string; description: string; quantity: number }>();
      for (const item of items) {
        const current = bySku.get(item.sku) ?? {
          sku: item.sku,
          description: item.description ?? "",
          quantity: 0,
        };
        current.quantity += item.quantity;
        if (!current.description && item.description) current.description = item.description;
        bySku.set(item.sku, current);
      }
      const occupied = new Set(
        items.filter((item) => item.quantity > 0).map((item) => item.locationId),
      );
      return {
        siteId: site.id,
        databaseName: site.databaseName ?? siteDatabaseName(site),
        label: siteLabel(site),
        codename: site.codename,
        units: items.reduce((sum, item) => sum + item.quantity, 0),
        skuCount: bySku.size,
        locationCount: locationIds.size,
        occupiedLocations: occupied.size,
        skus: [...bySku.values()].sort((left, right) => left.sku.localeCompare(right.sku)),
      };
    });
}

export function logisticsOptimization(system: InventorySystem): LogisticsOptimization {
  const insights = siteInsights(system);
  const labels = new Map(insights.map((insight) => [insight.siteId, insight.label]));
  const qtyBySku = new Map<
    string,
    Map<string, { quantity: number; description: string }>
  >();
  for (const insight of insights) {
    for (const sku of insight.skus) {
      const sites = qtyBySku.get(sku.sku) ?? new Map();
      sites.set(insight.siteId, { quantity: sku.quantity, description: sku.description });
      qtyBySku.set(sku.sku, sites);
    }
  }

  const suggestions: TransferSuggestion[] = [];
  let sharedSkuCount = 0;
  for (const [sku, sites] of qtyBySku) {
    if (sites.size < 2) continue;
    sharedSkuCount += 1;
    const ranked = [...sites.entries()].sort((left, right) => right[1].quantity - left[1].quantity);
    const [fromSiteId, fromStock] = ranked[0] ?? [];
    const [toSiteId, toStock] = ranked[ranked.length - 1] ?? [];
    if (!fromSiteId || !toSiteId || !fromStock || !toStock) continue;
    if (fromStock.quantity < 10 || fromStock.quantity < toStock.quantity * 2) continue;
    const quantity = Math.floor((fromStock.quantity - toStock.quantity) / 2);
    if (quantity < 1) continue;
    const destination = (system.locations ?? []).find(
      (location) =>
        location.isActive && locationSiteId(system, location) === toSiteId,
    );
    if (!destination) continue;
    suggestions.push({
      sku,
      description: fromStock.description,
      fromSiteId,
      toSiteId,
      fromLabel: labels.get(fromSiteId) ?? fromSiteId,
      toLabel: labels.get(toSiteId) ?? toSiteId,
      quantity,
    });
  }

  const occupancy: OccupancyRow[] = insights.map((insight) => ({
    siteId: insight.siteId,
    label: insight.label,
    occupied: insight.occupiedLocations,
    total: insight.locationCount,
  }));

  const velocity: VelocityRow[] = (system.sites ?? []).map((site) => {
    const buildingIds = new Set(
      (system.buildings ?? [])
        .filter((building) => building.siteId === site.id)
        .map((building) => building.id),
    );
    const zones = (system.zones ?? []).filter((zone) => buildingIds.has(zone.buildingId));
    const fastInbound = zones.filter((zone) => zone.inboundVelocity === "fast").length;
    const slowOutbound = zones.filter((zone) => zone.outboundVelocity === "slow").length;
    const row = occupancy.find((entry) => entry.siteId === site.id);
    const ratio = row && row.total > 0 ? row.occupied / row.total : 0;
    return {
      siteId: site.id,
      label: siteLabel(site),
      fastInbound,
      slowOutbound,
      tight: fastInbound > 0 && ratio >= 0.8,
    };
  });

  return {
    sharedSkuCount,
    suggestions: suggestions.sort((left, right) => left.sku.localeCompare(right.sku)),
    occupancy,
    velocity: velocity.sort((left, right) => left.label.localeCompare(right.label)),
  };
}

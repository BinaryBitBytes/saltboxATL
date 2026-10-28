import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "mocha";
import { expect } from "chai";
import { createSeedSystem } from "@/backend/server/seed";
import {
  readSiteDatabaseFile,
  writeSiteDatabaseFile,
} from "@/backend/server/site-files";
import { canAccessPath, hasPermission } from "@/lib/auth/permissions";
import { assignableRoles } from "@/lib/divisions";
import {
  authorizeSiteChange,
  canAccessMultiSite,
  selectSiteId,
  viewableSites,
} from "@/lib/sites/access";
import {
  WAREHOUSE_LEVELS,
  applySiteDocuments,
  buildWarehouseTree,
  collectLevels,
  openSiteWorkingCopy,
  partitionSiteDatabases,
  withoutSiteInventory,
} from "@/lib/sites/database";
import { logisticsOptimization } from "@/lib/sites/insight";
import { orderSiteTransfer } from "@/lib/sites/transfer";
import { ValidationError } from "@/lib/validation/errors";

describe("site inventory databases", () => {
  it("keeps the warehouse parent order site, building, zone, aisle, bay, location", () => {
    expect([...WAREHOUSE_LEVELS]).to.deep.equal([
      "site",
      "building",
      "zone",
      "aisle",
      "bay",
      "location",
    ]);
    const seed = createSeedSystem();
    const alpha = buildWarehouseTree(seed).find((node) => node.label === "ALPHA");
    expect(alpha?.level).to.equal("site");
    const building = alpha?.children.find((node) => node.level === "building");
    expect(collectLevels(building!).slice(0, 5)).to.deep.equal([
      "building",
      "zone",
      "aisle",
      "bay",
      "location",
    ]);
  });

  it("stores each site in its own database and hides the others from a standard user", () => {
    const seed = createSeedSystem();
    const documents = partitionSiteDatabases(seed);
    const names = documents.map((document) => document.databaseName);
    expect(new Set(names).size).to.equal(names.length);
    expect(names).to.include("saltbox_hyperscale_alpha");
    expect(names).to.include("saltbox_hyperscale_beta");
    expect(names).to.include("saltbox_security_sierra");

    const alpha = documents.find((document) => document.databaseName === "saltbox_hyperscale_alpha");
    const beta = documents.find((document) => document.databaseName === "saltbox_hyperscale_beta");
    expect(alpha?.inventoryItems.some((item) => item.sku === "PWR-PDU-30A")).to.equal(false);
    expect(beta?.inventoryItems.some((item) => item.sku === "FBR-LC-12-100")).to.equal(false);
    expect(beta?.inventoryItems.some((item) => item.sku === "PWR-PDU-30A")).to.equal(true);

    const rebuilt = applySiteDocuments(withoutSiteInventory(seed), documents);
    expect(rebuilt.inventoryItems.map((item) => item.sku).sort()).to.deep.equal(
      seed.inventoryItems.map((item) => item.sku).sort(),
    );

    const alphaSite = seed.sites.find((site) => site.codename === "ALPHA");
    const betaSite = seed.sites.find((site) => site.codename === "BETA");
    expect(alphaSite && betaSite).to.not.equal(undefined);
    const working = openSiteWorkingCopy(
      withoutSiteInventory(seed),
      "hyperscale",
      alpha!,
    );
    expect(working.sites.map((site) => site.codename)).to.deep.equal(["ALPHA"]);
    expect(working.inventoryItems.some((item) => item.sku === "PWR-PDU-30A")).to.equal(false);
    expect(working.inventoryItems.some((item) => item.sku === "FBR-LC-12-100")).to.equal(true);

    expect(
      viewableSites({
        role: "user",
        sites: seed.sites,
        division: "hyperscale",
        homeSiteId: alphaSite!.id,
      }).map((site) => site.codename),
    ).to.deep.equal(["ALPHA"]);
    expect(
      selectSiteId({
        role: "associate",
        requested: betaSite!.id,
        homeSiteId: alphaSite!.id,
        sites: seed.sites,
        division: "hyperscale",
      }),
    ).to.equal(alphaSite!.id);
    expect(canAccessPath("user", "/network")).to.equal(false);
    expect(canAccessPath("manager", "/network")).to.equal(false);
    expect(hasPermission("coordinator", "viewSiteNetwork")).to.equal(false);
  });

  it("lets only the multi-site roles open another work site", () => {
    const seed = createSeedSystem();
    const beta = seed.sites.find((site) => site.codename === "BETA");
    expect(beta).to.not.equal(undefined);
    for (const role of [
      "product-developer",
      "logistics-coordinator",
      "it-admin",
      "superintendent",
      "project-manager",
    ] as const) {
      expect(canAccessMultiSite(role), role).to.equal(true);
      expect(hasPermission(role, "transferBetweenSites"), role).to.equal(true);
      expect(hasPermission(role, "optimizeLogistics"), role).to.equal(true);
      expect(canAccessPath(role, "/network"), role).to.equal(true);
      expect(
        viewableSites({
          role,
          sites: seed.sites,
          division: "hyperscale",
        }).map((site) => site.codename),
      ).to.deep.equal(["ALPHA", "BETA"]);
    }
    expect(
      authorizeSiteChange({
        role: "manager",
        requested: beta!.id,
        sites: seed.sites,
        division: "hyperscale",
      }).ok,
    ).to.equal(false);
    expect(
      authorizeSiteChange({
        role: "project-manager",
        requested: beta!.id,
        sites: seed.sites,
        division: "hyperscale",
      }),
    ).to.deep.equal({ ok: true, siteId: beta!.id });
    expect(
      authorizeSiteChange({
        role: "it-admin",
        requested: "not-a-site",
        sites: seed.sites,
        division: "hyperscale",
      }).ok,
    ).to.equal(false);
    expect(assignableRoles("it-admin")).to.include("associate");
    expect(assignableRoles("it-admin")).to.not.include("security-associate");
  });

  it("orders a transfer between site databases and suggests rebalancing surplus", () => {
    const system = createSeedSystem();
    const sourceLocation = system.locations.find((location) => location.code === "A-01-01");
    const destination = system.locations.find((location) => location.code === "BETA-001-B01-01-A01");
    const source = system.inventoryItems.find(
      (item) => item.sku === "CAT6-BLU-1000" && item.locationId === sourceLocation?.id,
    );
    expect(source && destination).to.not.equal(undefined);
    expect(() =>
      orderSiteTransfer(system, {
        inventoryItemId: source!.id,
        destinationLocationId: sourceLocation!.id,
        quantity: 1,
        orderedBy: "Avery Product",
        now: "2026-10-28T18:00:00.000Z",
      }),
    ).to.throw(ValidationError, /one work site/i);

    const transfer = orderSiteTransfer(system, {
      inventoryItemId: source!.id,
      destinationLocationId: destination!.id,
      quantity: 2,
      orderedBy: "Avery Product",
      now: "2026-10-28T18:00:00.000Z",
    });
    expect(transfer.status).to.equal("ordered");
    expect(transfer.sourceSiteId).to.not.equal(transfer.destinationSiteId);
    expect(system.inventoryItems.find((item) => item.id === source!.id)?.quantity).to.equal(46);
    expect(
      system.inventoryItems.find(
        (item) => item.sku === "CAT6-BLU-1000" && item.locationId === destination!.id,
      )?.quantity,
    ).to.equal(10);

    const documents = partitionSiteDatabases(system);
    const alpha = documents.find((document) => document.databaseName === "saltbox_hyperscale_alpha");
    const beta = documents.find((document) => document.databaseName === "saltbox_hyperscale_beta");
    expect(alpha?.transactions.some((entry) => entry.type === "site-transfer" && entry.quantityDelta < 0)).to.equal(true);
    expect(beta?.transactions.some((entry) => entry.type === "site-transfer" && entry.quantityDelta > 0)).to.equal(true);
    expect(beta?.inventoryItems.some((item) => item.sku === "FBR-LC-12-100")).to.equal(false);

    const flow = logisticsOptimization(createSeedSystem());
    const suggestion = flow.suggestions.find((entry) => entry.sku === "CAT6-BLU-1000");
    expect(suggestion?.quantity).to.equal(20);
    expect(flow.velocity.some((row) => row.label.includes("Beta yard") && row.tight)).to.equal(true);
  });

  it("writes one database file per site", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "saltbox-sites-"));
    const previous = process.env.SALTBOX_SITE_DATABASE_DIR;
    process.env.SALTBOX_SITE_DATABASE_DIR = directory;
    try {
      const seed = createSeedSystem();
      const beta = partitionSiteDatabases(seed).find(
        (document) => document.databaseName === "saltbox_hyperscale_beta",
      );
      expect(beta).to.not.equal(undefined);
      await writeSiteDatabaseFile(beta!);
      const loaded = await readSiteDatabaseFile(beta!.databaseName);
      expect(loaded?.inventoryItems.map((item) => item.sku).sort()).to.deep.equal(
        beta!.inventoryItems.map((item) => item.sku).sort(),
      );
      expect(await readSiteDatabaseFile("saltbox_hyperscale_alpha")).to.equal(null);
    } finally {
      if (previous === undefined) delete process.env.SALTBOX_SITE_DATABASE_DIR;
      else process.env.SALTBOX_SITE_DATABASE_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

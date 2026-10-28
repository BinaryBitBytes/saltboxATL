import { describe, it } from "mocha";
import { expect } from "chai";
import { createSeedSystem } from "@/backend/server/seed";
import {
  authorizeSiteChange,
  resolveAssignedSites,
  selectSiteId,
  viewableSites,
} from "@/lib/sites/access";

describe("assigned site access", () => {
  const seed = createSeedSystem();
  const alpha = seed.sites.find((site) => site.codename === "ALPHA");
  const beta = seed.sites.find((site) => site.codename === "BETA");
  const sierra = seed.sites.find((site) => site.codename === "SIERRA");

  it("lets managers grant and deny each work site", () => {
    expect(alpha && beta && sierra).to.not.equal(undefined);
    const granted = resolveAssignedSites({
      sites: seed.sites,
      division: "hyperscale",
      allowedSiteIds: [alpha!.id, beta!.id],
      siteId: beta!.id,
    });
    expect(granted).to.deep.equal({
      ok: true,
      allowedSiteIds: [alpha!.id, beta!.id],
      siteId: beta!.id,
    });

    const deniedHome = resolveAssignedSites({
      sites: seed.sites,
      division: "hyperscale",
      allowedSiteIds: [alpha!.id],
      siteId: beta!.id,
    });
    expect(deniedHome).to.deep.equal({
      ok: false,
      error: "The home site must be an allowed work site.",
    });

    const none = resolveAssignedSites({
      sites: seed.sites,
      division: "hyperscale",
      allowedSiteIds: [],
      siteId: alpha!.id,
    });
    expect(none).to.deep.equal({
      ok: false,
      error: "Allow at least one work site.",
    });

    const otherDivision = resolveAssignedSites({
      sites: seed.sites,
      division: "hyperscale",
      allowedSiteIds: [sierra!.id],
      siteId: sierra!.id,
    });
    expect(otherDivision).to.deep.equal({
      ok: false,
      error: "That work site is not in this user's division.",
    });
  });

  it("opens only the sites a login was allowed, including standard users", () => {
    const allowed = [alpha!.id];
    expect(
      viewableSites({
        role: "project-manager",
        sites: seed.sites,
        division: "hyperscale",
        allowedSiteIds: allowed,
      }).map((site) => site.codename),
    ).to.deep.equal(["ALPHA"]);
    expect(
      selectSiteId({
        role: "project-manager",
        requested: beta!.id,
        homeSiteId: alpha!.id,
        sites: seed.sites,
        division: "hyperscale",
        allowedSiteIds: allowed,
      }),
    ).to.equal(alpha!.id);

    expect(
      viewableSites({
        role: "associate",
        sites: seed.sites,
        division: "hyperscale",
        homeSiteId: alpha!.id,
        allowedSiteIds: [alpha!.id, beta!.id],
      }).map((site) => site.codename),
    ).to.deep.equal(["ALPHA", "BETA"]);
    expect(
      authorizeSiteChange({
        role: "associate",
        requested: beta!.id,
        sites: seed.sites,
        division: "hyperscale",
        allowedSiteIds: [alpha!.id, beta!.id],
      }),
    ).to.deep.equal({ ok: true, siteId: beta!.id });
    expect(
      authorizeSiteChange({
        role: "associate",
        requested: beta!.id,
        sites: seed.sites,
        division: "hyperscale",
        homeSiteId: alpha!.id,
      }).ok,
    ).to.equal(false);
  });

  it("keeps the role default when site access has not been assigned", () => {
    expect(
      viewableSites({
        role: "it-admin",
        sites: seed.sites,
        division: "hyperscale",
      }).map((site) => site.codename),
    ).to.deep.equal(["ALPHA", "BETA"]);
    expect(
      viewableSites({
        role: "user",
        sites: seed.sites,
        division: "hyperscale",
        homeSiteId: alpha!.id,
      }).map((site) => site.codename),
    ).to.deep.equal(["ALPHA"]);
  });
});

import { describe, it } from "mocha";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSaltboxManifest } from "@/lib/pwa/manifest";
import {
  isIosDevice,
  isStandaloneDisplay,
  shouldShowInstallHelp,
} from "@/lib/pwa/display";
import {
  isPublicApiPath,
  isPublicAppPath,
  isPublicPagePath,
  isPublicPwaPath,
} from "@/lib/pwa/public-paths";

describe("progressive web app install", () => {
  it("exposes a standalone web app manifest with required install icons", () => {
    const manifest = createSaltboxManifest();
    expect(manifest.name).to.equal("Saltbox Inventory");
    expect(manifest.short_name).to.equal("Saltbox");
    expect(manifest.start_url).to.equal("/");
    expect(manifest.display).to.equal("standalone");
    expect(manifest.icons?.map((icon) => icon.sizes)).to.include.members([
      "192x192",
      "512x512",
    ]);
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).to.equal(
      true,
    );
    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).to.include.members([
      "/receiving",
      "/putaway",
      "/shipping",
    ]);
  });

  it("lets browsers fetch the service worker and icons without signing in", () => {
    expect(isPublicPagePath("/login")).to.equal(true);
    expect(isPublicApiPath("/api/auth/login")).to.equal(true);
    expect(isPublicApiPath("/api/auth/register")).to.equal(true);
    expect(isPublicApiPath("/api/auth/recover-username")).to.equal(true);
    expect(isPublicApiPath("/api/auth/reset-password")).to.equal(true);
    expect(isPublicApiPath("/api/health")).to.equal(true);
    expect(isPublicPwaPath("/sw.js")).to.equal(true);
    expect(isPublicPwaPath("/manifest.webmanifest")).to.equal(true);
    expect(isPublicPwaPath("/icons/icon-192.png")).to.equal(true);
    expect(isPublicPwaPath("/icon")).to.equal(true);
    expect(isPublicAppPath("/sw.js")).to.equal(true);
    expect(isPublicAppPath("/receiving")).to.equal(false);
  });

  it("registers a service worker that intercepts GET fetches", () => {
    const source = readFileSync(
      path.join(process.cwd(), "public/sw.js"),
      "utf8",
    );
    expect(source).to.match(/addEventListener\(\s*["']install["']/);
    expect(source).to.match(/addEventListener\(\s*["']fetch["']/);
    expect(source).to.match(/skipWaiting/);
    expect(source).to.match(/clients\.claim/);
  });

  it("hides install help until the client knows this is not an installed app", () => {
    expect(shouldShowInstallHelp(false, false)).to.equal(false);
    expect(shouldShowInstallHelp(true, true)).to.equal(false);
    expect(shouldShowInstallHelp(true, false)).to.equal(true);
  });

  it("hides install help in the original tab after this session installs the app", () => {
    expect(shouldShowInstallHelp(true, false, true)).to.equal(false);
  });

  it("detects standalone display and iOS home-screen apps", () => {
    const browserTab = {
      matchMedia: (query: string) => ({ matches: false, media: query }),
      navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Chrome/120)" },
    } as unknown as Window;
    const installed = {
      matchMedia: (query: string) => ({
        matches: query.includes("display-mode: standalone"),
        media: query,
      }),
      navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Chrome/120)" },
    } as unknown as Window;
    const iphoneSafari = {
      matchMedia: (query: string) => ({ matches: false, media: query }),
      navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    } as unknown as Window;

    expect(isStandaloneDisplay(browserTab)).to.equal(false);
    expect(isStandaloneDisplay(installed)).to.equal(true);
    expect(isIosDevice(iphoneSafari)).to.equal(true);
    expect(isIosDevice(browserTab)).to.equal(false);
  });
});

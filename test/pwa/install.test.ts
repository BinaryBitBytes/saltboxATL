import { describe, it } from "mocha";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSaltboxManifest } from "@/lib/pwa/manifest";
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
});

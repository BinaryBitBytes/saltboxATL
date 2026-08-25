import type { MetadataRoute } from "next";

export const PWA_THEME_COLOR = "#252525";
export const PWA_BACKGROUND_COLOR = "#252525";

export function createSaltboxManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Saltbox Inventory",
    short_name: "Saltbox",
    description: "Receive, put away, and ship warehouse inventory.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    orientation: "any",
    lang: "en",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Receiving",
        short_name: "Receiving",
        description: "Check in inbound freight",
        url: "/receiving",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Putaway",
        short_name: "Putaway",
        description: "Assign bin locations",
        url: "/putaway",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Shipping",
        short_name: "Shipping",
        description: "Pick and ship on-hand stock",
        url: "/shipping",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

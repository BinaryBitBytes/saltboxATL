import type { MetadataRoute } from "next";
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export const PWA_THEME_COLOR = "#252525";
export const PWA_BACKGROUND_COLOR = "#252525";

export function createSaltboxManifest(locale: Locale = "en"): MetadataRoute.Manifest {
  const t = (message: string) => translate(locale, message);
  return {
    id: "/",
    name: "Saltbox Inventory",
    short_name: "Saltbox",
    description: t("Receive, put away, and ship warehouse inventory."),
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: PWA_BACKGROUND_COLOR,
    theme_color: PWA_THEME_COLOR,
    orientation: "any",
    lang: locale,
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
        name: t("Receiving"),
        short_name: t("Receiving"),
        description: t("Check in inbound freight"),
        url: "/receiving",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: t("Putaway"),
        short_name: t("Putaway"),
        description: t("Assign bin locations"),
        url: "/putaway",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: t("Shipping"),
        short_name: t("Shipping"),
        description: t("Pick and ship on-hand stock"),
        url: "/shipping",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

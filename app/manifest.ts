import type { MetadataRoute } from "next";
import { createSaltboxManifest } from "@/lib/pwa/manifest";
import { getLocale } from "@/lib/i18n/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return createSaltboxManifest(await getLocale());
}

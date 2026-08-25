import type { MetadataRoute } from "next";
import { createSaltboxManifest } from "@/lib/pwa/manifest";

export default function manifest(): MetadataRoute.Manifest {
  return createSaltboxManifest();
}

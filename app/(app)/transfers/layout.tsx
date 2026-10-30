import type { ReactNode } from "react";
import { requirePermission } from "@/backend/server/dal";

export default async function TransfersLayout({ children }: { children: ReactNode }) {
  await requirePermission("transferFreight");
  return children;
}

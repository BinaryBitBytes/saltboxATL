import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ServiceError } from "@/backend/server/inventory-service";
import { readSystem } from "@/backend/server/store";
import {
  hasPermission,
  type Permission,
} from "@/lib/auth/permissions";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";
import type { PublicUser } from "@/lib/inventory-schema";
import { toPublicUser } from "@/lib/validation/user-security";

export { toPublicUser } from "@/lib/validation/user-security";

export const getSessionUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const system = await readSystem();
  const user = system.users.find((entry) => entry.id === payload.sub);
  if (!user || !user.isActive) return null;
  return toPublicUser(user);
});

export async function requireUser(): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requirePermission(
  permission: Permission,
): Promise<PublicUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) {
    redirect("/");
  }
  return user;
}

export async function requireApiUser(): Promise<PublicUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ServiceError("Sign in required.", 401);
  }
  return user;
}

export async function requireApiPermission(
  permission: Permission,
): Promise<PublicUser> {
  const user = await requireApiUser();
  if (!hasPermission(user.role, permission)) {
    throw new ServiceError("You do not have permission to do that.", 403);
  }
  return user;
}

export function withCreatedBy(
  rawData: unknown,
  user: PublicUser,
): Record<string, unknown> {
  const base =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {};
  return { ...base, createdBy: user.name, passwordHash: undefined, password: undefined };
}

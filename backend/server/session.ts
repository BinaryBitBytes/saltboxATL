import { cookies, headers } from "next/headers";
import type { PublicUser } from "@/lib/inventory-schema";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/token";

function requestFromHeaders(headerStore: Headers): Request {
  const proto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost";
  return new Request(`${proto}://${host}/`, { headers: headerStore });
}

export async function createSession(user: PublicUser): Promise<void> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE,
    signSession(user),
    sessionCookieOptions(requestFromHeaders(headerStore)),
  );
}

export async function deleteSession(): Promise<void> {
  const headerStore = await headers();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(requestFromHeaders(headerStore)),
    maxAge: 0,
  });
}

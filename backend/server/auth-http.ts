import { NextResponse } from "next/server";
import { asAuthError } from "@/backend/server/auth-service";
import { jsonError } from "@/backend/server/http";
import { authPageHref, type AuthPanel } from "@/lib/auth/login-page";
import { safeRedirectPath } from "@/lib/auth/permissions";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/token";
import type { PublicUser } from "@/lib/inventory-schema";

export function requestWantsJson(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.includes("application/json");
}

export async function readRequestObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }
    return body as Record<string, unknown>;
  }

  const form = await request.formData();
  const data: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") data[key] = value;
  }
  return data;
}

export function sessionRedirect(
  request: Request,
  user: PublicUser,
  from?: unknown,
) {
  const response = NextResponse.redirect(
    new URL(safeRedirectPath(from), request.url),
    303,
  );
  response.cookies.set(
    SESSION_COOKIE,
    signSession(user),
    sessionCookieOptions(),
  );
  return response;
}

export function authFormRedirect(
  request: Request,
  panel: AuthPanel,
  extra?: { error?: string; username?: string; reset?: boolean },
) {
  return NextResponse.redirect(new URL(authPageHref(panel, "/", extra), request.url), 303);
}

export function authFailure(
  request: Request,
  error: unknown,
  panel: AuthPanel,
  fallback: string,
) {
  if (requestWantsJson(request)) {
    return jsonError(error);
  }
  return authFormRedirect(request, panel, {
    error: asAuthError(error) || fallback,
  });
}

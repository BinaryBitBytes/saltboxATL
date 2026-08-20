import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "@/lib/auth/secret";
import { UserRoleSchema, type PublicUser, type UserRole } from "@/lib/inventory-schema";

export const SESSION_COOKIE = "saltbox_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  exp: number;
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export function signSession(
  user: Pick<PublicUser, "id" | "email" | "name" | "role">,
  maxAgeSeconds = SESSION_MAX_AGE,
): string {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getSessionSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined | null,
): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret())
    .update(body)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !UserRoleSchema.safeParse(payload.role).success) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

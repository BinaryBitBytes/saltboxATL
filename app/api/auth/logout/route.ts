import { jsonOk } from "@/backend/server/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";

export async function POST() {
  const response = jsonOk({ signedOut: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

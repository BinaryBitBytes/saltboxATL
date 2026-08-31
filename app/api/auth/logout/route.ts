import { NextResponse } from "next/server";
import { requestWantsJson } from "@/backend/server/auth-http";
import { jsonOk } from "@/backend/server/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  if (requestWantsJson(request)) {
    return clearSessionCookie(jsonOk({ signedOut: true }));
  }
  return clearSessionCookie(
    NextResponse.redirect(new URL("/login", request.url), 303),
  );
}

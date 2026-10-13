import { NextResponse } from "next/server";
import { requestWantsJson } from "@/backend/server/auth-http";
import { jsonOk } from "@/backend/server/http";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/token";

function clearSessionCookie(response: NextResponse, request: Request) {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(request),
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  if (requestWantsJson(request)) {
    return clearSessionCookie(jsonOk({ signedOut: true }), request);
  }
  return clearSessionCookie(
    NextResponse.redirect(new URL("/login", request.url), 303),
    request,
  );
}

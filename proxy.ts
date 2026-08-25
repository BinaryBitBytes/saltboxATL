import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canAccessPath } from "@/lib/auth/permissions";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";
import {
  isPublicAppPath,
  isPublicPagePath,
} from "@/lib/pwa/public-paths";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  if (isPublicAppPath(pathname)) {
    if (session && isPublicPagePath(pathname)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Sign in required." },
        { status: 401 },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccessPath(session.role, pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "You do not have permission to do that." },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};

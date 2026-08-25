const PUBLIC_PAGE_PATHS = new Set(["/login"]);
const PUBLIC_API_PATHS = new Set(["/api/auth/login", "/api/auth/logout"]);
const PUBLIC_PWA_PATHS = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/manifest.json",
  "/icon",
  "/apple-icon",
]);

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.has(pathname);
}

export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.has(pathname);
}

export function isPublicPwaPath(pathname: string): boolean {
  if (PUBLIC_PWA_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/icons/")) return true;
  if (pathname.startsWith("/icon/") || pathname.startsWith("/apple-icon/")) {
    return true;
  }
  return false;
}

export function isPublicAppPath(pathname: string): boolean {
  return (
    isPublicPagePath(pathname) ||
    isPublicApiPath(pathname) ||
    isPublicPwaPath(pathname)
  );
}

import { safeRedirectPath } from "@/lib/auth/permissions";

export const AUTH_PANELS = [
  "signin",
  "register",
  "recover-username",
  "reset-password",
] as const;

export type AuthPanel = (typeof AUTH_PANELS)[number];

export function parseAuthPanel(value: unknown): AuthPanel {
  if (typeof value === "string" && AUTH_PANELS.includes(value as AuthPanel)) {
    return value as AuthPanel;
  }
  return "signin";
}

export function authPageHref(
  panel: AuthPanel,
  from = "/",
  extra?: { error?: string; username?: string; reset?: boolean },
): string {
  const params = new URLSearchParams();
  if (panel !== "signin") params.set("mode", panel);
  const nextPath = safeRedirectPath(from);
  if (nextPath !== "/") params.set("from", nextPath);
  if (extra?.error) params.set("error", extra.error.slice(0, 180));
  if (extra?.username) params.set("username", extra.username);
  if (extra?.reset) params.set("reset", "1");
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

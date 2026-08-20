export const THEME_STORAGE_KEY = "saltbox-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

export const THEME_INIT_SCRIPT = `(function(){
  try {
    var stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    var preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
    var root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    root.dataset.theme = resolved;
  } catch (e) {}
})();`;

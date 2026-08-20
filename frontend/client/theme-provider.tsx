"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeSnapshot = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
};

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const SERVER_SNAPSHOT: ThemeSnapshot = {
  preference: "system",
  resolved: "light",
};

const THEME_CHANGE_EVENT = "saltbox-theme-change";
let cachedSnapshot: ThemeSnapshot = SERVER_SNAPSHOT;

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* private mode */
  }
  return "system";
}

function prefersDarkScheme(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  root.dataset.theme = resolved;
}

function readSnapshot(): ThemeSnapshot {
  const preference = readStoredPreference();
  const resolved = resolveTheme(preference, prefersDarkScheme());
  if (
    cachedSnapshot.preference === preference &&
    cachedSnapshot.resolved === resolved
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = { preference, resolved };
  return cachedSnapshot;
}

function subscribe(onStoreChange: () => void) {
  function handle() {
    applyResolvedTheme(readSnapshot().resolved);
    onStoreChange();
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", handle);
  window.addEventListener("storage", handle);
  window.addEventListener(THEME_CHANGE_EVENT, handle);
  return () => {
    media.removeEventListener("change", handle);
    window.removeEventListener("storage", handle);
    window.removeEventListener(THEME_CHANGE_EVENT, handle);
  };
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function persistPreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* private mode */
  }
  applyResolvedTheme(resolveTheme(preference, prefersDarkScheme()));
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribe,
    readSnapshot,
    getServerSnapshot,
  );

  const setPreference = useCallback((preference: ThemePreference) => {
    persistPreference(preference);
  }, []);

  const toggleTheme = useCallback(() => {
    persistPreference(snapshot.resolved === "dark" ? "light" : "dark");
  }, [snapshot.resolved]);

  const value = useMemo(
    () => ({
      preference: snapshot.preference,
      resolved: snapshot.resolved,
      setPreference,
      toggleTheme,
    }),
    [setPreference, snapshot.preference, snapshot.resolved, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

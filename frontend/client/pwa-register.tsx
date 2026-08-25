"use client";

import { useEffect } from "react";

const SW_PATH = "/sw.js";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    async function register() {
      try {
        await navigator.serviceWorker.register(SW_PATH, {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        if (!cancelled) {
          // Registration can fail on insecure origins besides localhost.
        }
      }
    }

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

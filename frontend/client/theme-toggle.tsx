"use client";

import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/frontend/client/theme-provider";

function subscribe() {
  return () => undefined;
}

export function ThemeToggle({ className }: { className?: string }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { resolved, toggleTheme } = useTheme();
  const isDark = resolved === "dark";

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label="Color theme"
        disabled
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      onClick={toggleTheme}
    >
      <HugeiconsIcon icon={isDark ? Sun02Icon : Moon02Icon} strokeWidth={2} />
    </Button>
  );
}

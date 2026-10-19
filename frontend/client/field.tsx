"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { useT } from "@/frontend/client/language";

export function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={htmlFor}>{t(label)}</Label>
      {children}
      {error ? (
        <p className="text-[0.625rem] text-destructive">{t(error)}</p>
      ) : null}
    </div>
  );
}

export function NativeSelect({
  className,
  "aria-label": ariaLabel,
  ...props
}: ComponentProps<"select">) {
  const t = useT();
  return (
    <select
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-input/20 px-2 text-xs/relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
      aria-label={typeof ariaLabel === "string" ? t(ariaLabel) : ariaLabel}
    />
  );
}

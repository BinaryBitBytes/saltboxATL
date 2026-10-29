"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { PinLocation01Icon } from "@hugeicons/core-free-icons";
import { setActiveSite } from "@/backend/server/site-actions";
import { T, useT } from "@/frontend/client/language";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-md border border-border bg-muted/50 px-2 text-xs font-medium text-foreground";

export function SiteControl({
  siteId,
  label,
  canSwitch,
  choices,
}: {
  siteId: string;
  label: string;
  canSwitch: boolean;
  choices: Array<{ id: string; label: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!canSwitch) {
    return (
      <span className={chipClass} data-testid="active-site" data-site-id={siteId}>
        <HugeiconsIcon icon={PinLocation01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
        <span className="sr-only">
          <T>Work site</T>
        </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative" data-testid="active-site" data-site-id={siteId}>
      <button
        type="button"
        className={cn(chipClass, "hover:bg-muted")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={pending}
        onClick={() => setOpen((current) => !current)}
      >
        <HugeiconsIcon icon={PinLocation01Icon} strokeWidth={2} className="size-3.5 shrink-0" />
        <span className="sr-only">
          <T>Work site</T>
        </span>
        <span className="truncate">{label}</span>
      </button>
      {open ? (
        <ul
          id={menuId}
          role="listbox"
          aria-label={t("Work sites")}
          className="absolute right-0 top-full z-50 mt-1 max-h-72 min-w-56 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {choices.map((choice) => {
            const selected = choice.id === siteId;
            return (
              <li key={choice.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted",
                    selected && "bg-muted font-medium",
                  )}
                  onClick={() => {
                    setError(null);
                    setOpen(false);
                    startTransition(async () => {
                      const result = await setActiveSite(choice.id);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      router.refresh();
                    });
                  }}
                >
                  {choice.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p className="absolute right-0 top-full z-50 mt-1 text-[0.625rem] text-destructive"><T>{error}</T></p> : null}
    </div>
  );
}

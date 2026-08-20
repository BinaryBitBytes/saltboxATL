"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  PackageOpenIcon,
  WarehouseIcon,
  TruckDeliveryIcon,
  PinLocation01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: DashboardSquare01Icon },
  { href: "/receiving", label: "Receiving", icon: PackageOpenIcon },
  { href: "/inventory", label: "Inventory", icon: WarehouseIcon },
  { href: "/shipping", label: "Shipping", icon: TruckDeliveryIcon },
  { href: "/locations", label: "Locations", icon: PinLocation01Icon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Saltbox Inventory
          </Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs/relaxed transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  PackageOpenIcon,
  PackageMovingIcon,
  WarehouseIcon,
  TruckDeliveryIcon,
  PinLocation01Icon,
  TransactionHistoryIcon,
  BookOpen02Icon,
  SearchList01Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/backend/server/auth-actions";
import { hasPermission, roleLabel, type Permission } from "@/lib/auth/permissions";
import type { PublicUser } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/frontend/client/theme-toggle";
import { InstallAppButton } from "@/frontend/client/pwa-install";

const NAV: Array<{
  href: string;
  label: string;
  icon: typeof DashboardSquare01Icon;
  permission: Permission;
}> = [
  { href: "/", label: "Dashboard", icon: DashboardSquare01Icon, permission: "viewDashboard" },
  { href: "/receiving", label: "Receiving", icon: PackageOpenIcon, permission: "receive" },
  { href: "/putaway", label: "Putaway", icon: PackageMovingIcon, permission: "putaway" },
  { href: "/inventory", label: "Inventory", icon: WarehouseIcon, permission: "viewInventory" },
  { href: "/reports", label: "Reports", icon: SearchList01Icon, permission: "viewInventory" },
  { href: "/shipping", label: "Shipping", icon: TruckDeliveryIcon, permission: "ship" },
  { href: "/logbook", label: "Logbook", icon: BookOpen02Icon, permission: "viewTransactions" },
  { href: "/transactions", label: "Stock log", icon: TransactionHistoryIcon, permission: "viewTransactions" },
  { href: "/locations", label: "Locations", icon: PinLocation01Icon, permission: "manageLocations" },
  { href: "/users", label: "Users", icon: UserMultipleIcon, permission: "manageUsers" },
];

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: PublicUser;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => hasPermission(user.role, item.permission));

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 print:hidden">
        <div className="page-container flex flex-col gap-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] short:py-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between landscape:short:flex-row landscape:short:items-center">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
              Saltbox Inventory
            </Link>
            <div className="flex items-center gap-1 sm:hidden">
              <InstallAppButton />
              <ThemeToggle />
              <Badge variant="outline">{roleLabel(user.role)}</Badge>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
          <nav
            aria-label="Main"
            className="scroll-touch -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1"
          >
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs/relaxed transition-colors landscape:short:h-7",
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
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <InstallAppButton />
            <ThemeToggle />
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {user.name}
            </span>
            <Badge variant="outline">{roleLabel(user.role)}</Badge>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="page-container flex-1 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-6 short:py-3">
        {children}
      </main>
    </div>
  );
}

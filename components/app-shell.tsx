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
  TransactionHistoryIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/backend/server/auth-actions";
import { hasPermission, roleLabel, type Permission } from "@/lib/auth/permissions";
import type { PublicUser } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV: Array<{
  href: string;
  label: string;
  icon: typeof DashboardSquare01Icon;
  permission: Permission;
}> = [
  { href: "/", label: "Dashboard", icon: DashboardSquare01Icon, permission: "viewDashboard" },
  { href: "/receiving", label: "Receiving", icon: PackageOpenIcon, permission: "receive" },
  { href: "/inventory", label: "Inventory", icon: WarehouseIcon, permission: "viewInventory" },
  { href: "/transactions", label: "Log", icon: TransactionHistoryIcon, permission: "viewTransactions" },
  { href: "/shipping", label: "Shipping", icon: TruckDeliveryIcon, permission: "ship" },
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
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Saltbox Inventory
          </Link>
          <nav className="flex flex-wrap gap-1">
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
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{user.name}</span>
            <Badge variant="outline">{roleLabel(user.role)}</Badge>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

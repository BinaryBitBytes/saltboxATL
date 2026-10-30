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
  CubeIcon,
  ShoppingBag01Icon,
  TruckDeliveryIcon,
  ArrowDataTransferHorizontalIcon,
  Alert02Icon,
  PinLocation01Icon,
  TransactionHistoryIcon,
  BookOpen02Icon,
  SearchList01Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { hasAnyPermission, hasPermission, roleLabel, type Permission } from "@/lib/auth/permissions";
import { divisionLabel } from "@/lib/divisions";
import type { Division, PublicUser } from "@/lib/inventory-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LanguageRadio, T, useT } from "@/frontend/client/language";
import { ThemeToggle } from "@/frontend/client/theme-toggle";
import { InstallAppButton } from "@/frontend/client/pwa-install";
import { DivisionSwitcher } from "@/frontend/client/division-switcher";
import { SiteControl } from "@/frontend/client/site-switcher";

const NAV: Array<{
  href: string;
  label: string;
  icon: typeof DashboardSquare01Icon;
  permission: Permission | Permission[];
}> = [
  { href: "/", label: "Dashboard", icon: DashboardSquare01Icon, permission: "viewDashboard" },
  { href: "/inbound", label: "Inbound", icon: SearchList01Icon, permission: "viewInboundForecast" },
  { href: "/receiving", label: "Receiving", icon: PackageOpenIcon, permission: "receive" },
  { href: "/putaway", label: "Putaway", icon: PackageMovingIcon, permission: "putaway" },
  { href: "/moves", label: "RF Moves", icon: ArrowDataTransferHorizontalIcon, permission: "moveInventory" },
  { href: "/inventory", label: "Inventory", icon: WarehouseIcon, permission: "viewInventory" },
  { href: "/damages", label: "Damages", icon: Alert02Icon, permission: "damageInventory" },
  { href: "/orders", label: "Orders", icon: ShoppingBag01Icon, permission: ["placeOrder", "fulfillOrder"] },
  { href: "/cubing", label: "Cubing", icon: CubeIcon, permission: "cube" },
  { href: "/reports", label: "Reports", icon: SearchList01Icon, permission: "viewInventory" },
  { href: "/shipping", label: "Shipping", icon: TruckDeliveryIcon, permission: "ship" },
  { href: "/loads", label: "My loads", icon: TruckDeliveryIcon, permission: "viewDriverLoad" },
  { href: "/logbook", label: "Logbook", icon: BookOpen02Icon, permission: "viewTransactions" },
  { href: "/transactions", label: "Stock log", icon: TransactionHistoryIcon, permission: "viewTransactions" },
  { href: "/locations", label: "Locations", icon: PinLocation01Icon, permission: "manageLocations" },
  { href: "/network", label: "Sites", icon: PinLocation01Icon, permission: "viewSiteNetwork" },
  { href: "/users", label: "Users", icon: UserMultipleIcon, permission: "manageUsers" },
];

function DivisionControl({
  division,
  canSwitchDivision,
  divisionChoices,
}: {
  division: Division;
  canSwitchDivision: boolean;
  divisionChoices: readonly Division[];
}) {
  if (canSwitchDivision) {
    return (
      <DivisionSwitcher key={division} division={division} choices={divisionChoices} />
    );
  }
  return (
    <Badge variant="outline">
      <T>{divisionLabel(division)}</T>
    </Badge>
  );
}

export function AppShell({
  children,
  user,
  division,
  canSwitchDivision,
  divisionChoices,
  siteId,
  siteLabel,
  canSwitchSite,
  siteChoices,
}: {
  children: ReactNode;
  user: PublicUser;
  division: Division;
  canSwitchDivision: boolean;
  divisionChoices: readonly Division[];
  siteId: string;
  siteLabel: string;
  canSwitchSite: boolean;
  siteChoices: Array<{ id: string; label: string }>;
}) {
  const pathname = usePathname();
  const t = useT();
  const items = NAV.filter((item) =>
    Array.isArray(item.permission)
      ? hasAnyPermission(user.role, item.permission)
      : hasPermission(user.role, item.permission),
  );

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 print:hidden">
        <div className="page-container flex flex-wrap items-center justify-between gap-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] short:py-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">
              Saltbox Inventory
            </Link>
            <InstallAppButton />
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-1 sm:gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {user.name}
            </span>
            <Badge variant="outline" className="hidden sm:inline-flex">
              <T>{roleLabel(user.role)}</T>
            </Badge>
            <DivisionControl
              division={division}
              canSwitchDivision={canSwitchDivision}
              divisionChoices={divisionChoices}
            />
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="ghost" size="sm"><T>Sign out</T></Button>
            </form>
            <LanguageRadio />
            <SiteControl
              siteId={siteId}
              label={siteLabel}
              canSwitch={canSwitchSite}
              choices={siteChoices}
            />
          </div>
        </div>
        <div className="page-container pb-2 short:pb-1">
          <nav
            aria-label={t("Main")}
            className="scroll-touch relative z-0 -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1"
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
                  <T>{item.label}</T>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="page-container flex-1 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-6 short:py-3">
        {children}
      </main>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PhotoThumbnails } from "@/frontend/client/photo-proof";
import {
  LoadManifestSheet,
  PackSlipSheet,
} from "@/frontend/client/shipment-documents";
import {
  ReceivingStatusBadge,
  ShippingStatusBadge,
} from "@/frontend/client/status-badge";
import type { LogbookEntry, LogbookKind } from "@/lib/logbook/entries";
import type { ReceivingOrderStatus, ShippingOrderStatus } from "@/lib/inventory-schema";
import { formatDateTime } from "@/lib/format";

const FILTERS: Array<{ id: "all" | LogbookKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "shipment", label: "Shipments" },
  { id: "delivery", label: "Deliveries" },
  { id: "damage", label: "Damages" },
];

function KindBadge({ kind }: { kind: LogbookKind }) {
  if (kind === "shipment") return <Badge>shipment</Badge>;
  if (kind === "delivery") return <Badge variant="secondary">delivery</Badge>;
  return <Badge variant="destructive">damage</Badge>;
}

function StatusMark({ entry }: { entry: LogbookEntry }) {
  if (entry.kind === "shipment" && entry.status) {
    return <ShippingStatusBadge status={entry.status as ShippingOrderStatus} />;
  }
  if (entry.kind === "delivery" && entry.status) {
    return <ReceivingStatusBadge status={entry.status as ReceivingOrderStatus} />;
  }
  return null;
}

export function LogbookWorkspace({
  entries,
  canOpenShipments = false,
  canOpenDeliveries = false,
  canOpenInventory = false,
}: {
  entries: LogbookEntry[];
  canOpenShipments?: boolean;
  canOpenDeliveries?: boolean;
  canOpenInventory?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | LogbookKind>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      if (!needle) return true;
      const haystack = [
        entry.title,
        entry.subtitle,
        entry.actor,
        entry.carrier,
        entry.notes,
        entry.reason,
        ...entry.lines.map((line) => `${line.sku} ${line.description ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, kind, query]);

  const counts = {
    shipment: entries.filter((entry) => entry.kind === "shipment").length,
    delivery: entries.filter((entry) => entry.kind === "delivery").length,
    damage: entries.filter((entry) => entry.kind === "damage").length,
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.id}
            type="button"
            size="sm"
            variant={kind === filter.id ? "default" : "outline"}
            onClick={() => setKind(filter.id)}
          >
            {filter.label}
            {filter.id !== "all" ? (
              <span className="text-muted-foreground"> {counts[filter.id]}</span>
            ) : null}
          </Button>
        ))}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search shipment, PO, vendor, customer, SKU, or reason"
        className="max-w-lg"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No logbook entries match that filter.
        </p>
      ) : (
        filtered.map((entry) => {
          const open = openId === entry.id;
          const href =
            entry.kind === "shipment" && canOpenShipments
              ? entry.href
              : entry.kind === "delivery" && canOpenDeliveries
                ? entry.href
                : entry.kind === "damage" && canOpenInventory
                  ? entry.href
                  : undefined;
          return (
            <Card key={entry.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{entry.title}</CardTitle>
                    <CardDescription>{entry.subtitle}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge kind={entry.kind} />
                    <StatusMark entry={entry} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.occurredAt)}
                  {entry.actor ? ` · ${entry.actor}` : ""}
                  {entry.carrier ? ` · ${entry.carrier}` : ""}
                  {` · ${entry.totals.units} unit${entry.totals.units === 1 ? "" : "s"}`}
                  {entry.photos.length
                    ? ` · ${entry.photos.length} photo${entry.photos.length === 1 ? "" : "s"}`
                    : ""}
                </p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap gap-2 print:hidden">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenId(open ? null : entry.id)}
                  >
                    {open ? "Hide details" : "Review"}
                  </Button>
                  {href ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={href} />}
                    >
                      Open record
                    </Button>
                  ) : null}
                </div>
                {open ? (
                  <div className="grid gap-4">
                    {entry.reason ? (
                      <p className="text-sm">Reason: {entry.reason}</p>
                    ) : null}
                    {entry.notes ? (
                      <p className="text-sm text-muted-foreground">{entry.notes}</p>
                    ) : null}
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead className="border-b text-left">
                          <tr>
                            <th className="px-2 py-2 font-medium">SKU</th>
                            <th className="px-2 py-2 font-medium">Detail</th>
                            <th className="px-2 py-2 font-medium">Location</th>
                            <th className="px-2 py-2 text-right font-medium">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.lines.length === 0 ? (
                            <tr>
                              <td
                                className="px-2 py-3 text-muted-foreground"
                                colSpan={4}
                              >
                                No line items recorded.
                              </td>
                            </tr>
                          ) : (
                            entry.lines.map((line, index) => (
                              <tr
                                key={`${line.sku}-${index}`}
                                className="border-b last:border-0"
                              >
                                <td className="px-2 py-2 font-medium">{line.sku}</td>
                                <td className="px-2 py-2 text-muted-foreground">
                                  {line.description || line.batch || "—"}
                                </td>
                                <td className="px-2 py-2">{line.location || "—"}</td>
                                <td className="px-2 py-2 text-right">
                                  {line.quantity}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium">Proof photos</p>
                      <PhotoThumbnails photos={entry.photos} />
                    </div>
                    {entry.packSlip ? <PackSlipSheet doc={entry.packSlip} /> : null}
                    {entry.manifest ? (
                      <LoadManifestSheet doc={entry.manifest} />
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

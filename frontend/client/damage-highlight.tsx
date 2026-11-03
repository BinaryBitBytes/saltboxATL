"use client";

import { T } from "@/frontend/client/language";
import { DAMAGE_LOG_HIGHLIGHT } from "@/lib/inventory/damage";
import {
  ALLOCATION_LOG_HIGHLIGHT,
  RELEASE_LOG_HIGHLIGHT,
} from "@/lib/inventory/stock-log";

export function DamageLogLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          data-damage-highlight="true"
          className={`inline-block size-3 rounded-sm border ${DAMAGE_LOG_HIGHLIGHT}`}
        />
        <T>Damaged transactions are highlighted.</T>
      </p>
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          data-stock-highlight="allocation"
          className={`inline-block size-3 rounded-sm border ${ALLOCATION_LOG_HIGHLIGHT}`}
        />
        <T>Allocations are highlighted in blue.</T>
      </p>
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          data-stock-highlight="allocation-release"
          className={`inline-block size-3 rounded-sm border ${RELEASE_LOG_HIGHLIGHT}`}
        />
        <T>Allocation releases are highlighted in yellow.</T>
      </p>
    </div>
  );
}

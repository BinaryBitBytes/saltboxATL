"use client";

import { T } from "@/frontend/client/language";
import { DAMAGE_LOG_HIGHLIGHT } from "@/lib/inventory/damage";

export function DamageLogLegend() {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        data-damage-highlight="true"
        className={`inline-block size-3 rounded-sm border ${DAMAGE_LOG_HIGHLIGHT}`}
      />
      <T>Damaged transactions are highlighted.</T>
    </p>
  );
}

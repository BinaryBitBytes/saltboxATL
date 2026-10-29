"use client";

import { T } from "@/frontend/client/language";
import { useState, useTransition } from "react";
import { setActiveDivision } from "@/backend/server/division-actions";
import { NativeSelect } from "@/frontend/client/field";
import { divisionLabel } from "@/lib/divisions";
import type { Division } from "@/lib/inventory-schema";

export function DivisionSwitcher({
  division,
  choices,
}: {
  division: Division;
  choices: readonly Division[];
}) {
  const [value, setValue] = useState(division);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-0.5">
      <label htmlFor="active-division" className="sr-only"><T>Division</T></label>
      <NativeSelect
        id="active-division"
        aria-label="Division"
        className="h-7 w-auto min-w-36"
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as Division;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setActiveDivision(next);
            if (!result.ok) {
              setValue(division);
              setError(result.error);
            }
          });
        }}
      >
        {(choices.length > 0 ? choices : [division]).map((id) => (
          <option key={id} value={id}>
            <T>{divisionLabel(id)}</T>
          </option>
        ))}
      </NativeSelect>
      {error ? <p className="text-[0.625rem] text-destructive"><T>{error}</T></p> : null}
    </div>
  );
}

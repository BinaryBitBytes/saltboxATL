"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({
  id,
  name,
  autoComplete,
  required,
  minLength,
  className,
  value,
  onChange,
}: {
  id: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onInput={(event) => onChange?.(event.currentTarget.value)}
        className={cn(inputClassName, "pr-8", className)}
      />
      <button
        type="button"
        className="absolute top-1/2 right-0.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => setVisible((current) => !current)}
      >
        <HugeiconsIcon
          icon={visible ? ViewOffIcon : ViewIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { translate } from "@/lib/i18n/translate"
import { useLocale } from "@/frontend/client/language"

function Textarea({ className, placeholder, ...props }: React.ComponentProps<"textarea">) {
  const locale = useLocale()
  const ariaLabel = props["aria-label"]
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input bg-input/20 px-2 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      placeholder={typeof placeholder === "string" ? translate(locale, placeholder) : placeholder}
      {...props}
      aria-label={typeof ariaLabel === "string" ? translate(locale, ariaLabel) : ariaLabel}
    />
  )
}

export { Textarea }

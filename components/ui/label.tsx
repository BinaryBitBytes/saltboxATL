"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { translateNode, useLocale } from "@/frontend/client/language"

function Label({ className, children, ...props }: React.ComponentProps<"label">) {
  const locale = useLocale()
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {translateNode(children, locale)}
    </label>
  )
}

export { Label }

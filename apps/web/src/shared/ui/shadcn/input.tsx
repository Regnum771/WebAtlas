import * as React from "react"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add input`, then restyled with WebATLAS's tokens. The border is ink-2
// (6.9:1), not `line`: WCAG 1.4.11 asks for 3:1 on an input's boundary. Focus is the global
// R9 rule.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-control w-full min-w-0 rounded-md border border-ink-2 bg-surface px-3 text-panel text-ink disabled:cursor-default disabled:bg-surface-2 disabled:text-ink-2 aria-invalid:border-2 aria-invalid:border-alert",
        className
      )}
      {...props}
    />
  )
}

export { Input }

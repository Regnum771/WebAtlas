import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add checkbox`, restyled with the WebATLAS tokens: a square box (no
// switch), an ink-2 border for 3:1 on its boundary, a brand fill when checked.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-ink-2 bg-surface text-surface data-[state=checked]:border-brand data-[state=checked]:bg-brand disabled:cursor-default disabled:border-line disabled:bg-surface-2",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

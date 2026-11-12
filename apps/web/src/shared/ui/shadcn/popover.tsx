import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add popover`, cut to the parts WebATLAS uses and restyled with its
// tokens. The content carries no data-slot on purpose: popovers hold legacy menu bodies,
// which need the browser defaults the legacy-compat sheet restores.

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-[60] rounded-lg border border-solid border-line bg-surface p-3 text-body text-ink shadow-pop",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }

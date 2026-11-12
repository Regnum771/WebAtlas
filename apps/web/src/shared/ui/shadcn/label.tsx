import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add label`, then restyled with WebATLAS's tokens.
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("font-semibold", className)}
      {...props}
    />
  )
}

export { Label }

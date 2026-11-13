import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add tabs`, cut to the underline variant (segmented tabs are banned by the
// spec) and restyled with WebATLAS tokens: 32 px triggers, 13 px text, a 2 px brand underline on
// the active tab, a line-2 rule under the list.

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex min-h-0 flex-col", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex h-control items-stretch gap-3 border-0 border-b border-solid border-line-2", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative -mb-px inline-flex cursor-pointer items-center gap-1.5 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 text-body whitespace-nowrap text-ink-2 transition-colors duration-[var(--motion-fast)] hover:text-ink disabled:cursor-default disabled:opacity-50 data-[state=active]:border-brand data-[state=active]:font-semibold data-[state=active]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("min-h-0 flex-1", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

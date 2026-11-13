import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add drawer` (Vaul), cut to the right-hand drawer the map dock uses below
// 1100 px and restyled with WebATLAS tokens. No handle pill (pill shapes are banned) and no dimming
// overlay: the map stays readable beside the drawer. The content is placed by its caller, so it can
// stop above the status bar (R8).

const Drawer = DrawerPrimitive.Root
const DrawerTitle = DrawerPrimitive.Title
const DrawerDescription = DrawerPrimitive.Description
const DrawerClose = DrawerPrimitive.Close

function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed z-50 flex flex-col border-0 border-l border-solid border-line bg-surface text-ink shadow-pop",
          className
        )}
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  )
}

export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle }

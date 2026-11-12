import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add dialog`, then cut to the parts WebATLAS uses and restyled with its
// tokens. The content sits inside the overlay (Radix supports this), as the old backdrop held
// its panel: the overlay centres it, and a press on the overlay is a press outside.

const Dialog = DialogPrimitive.Root

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/40"
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "min-w-80 max-w-[90vw] max-h-[90vh] overflow-auto p-3.5 bg-surface text-ink border border-line rounded-lg shadow-pop",
            className
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("mb-2 text-panel font-semibold", className)}
      {...props}
    />
  )
}

export { Dialog, DialogContent, DialogTitle }

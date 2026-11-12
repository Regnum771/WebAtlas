import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add alert-dialog`, then cut to the parts WebATLAS uses and restyled
// with its tokens, in the same shape as ./dialog.tsx (content inside the overlay). No Action
// part: confirming must not close the dialog by itself, the caller decides (busy, errors).

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogCancel = AlertDialogPrimitive.Cancel

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/40"
      >
        <AlertDialogPrimitive.Content
          data-slot="alert-dialog-content"
          className={cn(
            "min-w-80 max-w-[90vw] max-h-[90vh] overflow-auto p-3.5 bg-surface text-ink border border-line rounded-lg shadow-pop",
            className
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Overlay>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("mb-2 text-panel font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("mb-3.5", className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
}

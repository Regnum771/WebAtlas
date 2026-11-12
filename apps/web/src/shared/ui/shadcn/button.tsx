import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add button`, then given WebATLAS's variants and sizes (spec "Visual
// system → Rules"). Focus styling is left to the global R9 rule in app.css.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold text-body whitespace-nowrap cursor-pointer aria-disabled:cursor-default aria-disabled:border-line aria-disabled:bg-surface-2 aria-disabled:text-ink-2 disabled:cursor-default disabled:border-line disabled:bg-surface-2 disabled:text-ink-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        outline: "border-line bg-surface text-ink hover:bg-surface-2",
        solid: "border-brand bg-brand text-surface",
        quiet: "border-transparent bg-transparent text-ink hover:bg-surface-2",
        danger: "border-alert bg-alert text-surface",
      },
      size: {
        md: "h-control px-3",
        sm: "h-control-sm px-2.5",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "md",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "md",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

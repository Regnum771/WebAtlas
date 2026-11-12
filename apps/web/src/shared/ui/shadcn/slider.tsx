import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

// Fetched with `shadcn add slider`, restyled with the WebATLAS tokens: a 2 px track and a
// square-cornered thumb (no pill shapes). One thumb; callers pass a one-value array.
function Slider({
  className,
  thumbLabel,
  thumbValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Accessible name of the thumb. */
  thumbLabel: string
  /** What a screen reader says for the current value. */
  thumbValueText?: string
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex touch-none items-center select-none data-[orientation=horizontal]:h-4 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-4 data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow bg-line data-[orientation=horizontal]:h-0.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-0.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-ink data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={thumbLabel}
        aria-valuetext={thumbValueText}
        className="block size-3 cursor-pointer rounded-sm border border-ink bg-surface"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }

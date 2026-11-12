import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './shadcn/tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** The accessible name, also shown as the tooltip. */
  label: string;
  /** The icon, decorative (aria-hidden). */
  children: ReactNode;
  /** Where the tooltip opens. */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * A 32 px square icon button for the map's tool stacks (spec "Map tools"): a 1 px line border,
 * 4 px corners, a brand-tint fill while pressed, and a tooltip naming it. Each button brings its
 * own tooltip provider, so it works wherever it is mounted.
 */
export function IconButton({ label, children, side = 'left', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            {...rest}
            type={type}
            aria-label={label}
            data-slot="icon-button"
            className={cn(
              'inline-flex size-control shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-surface-2 aria-pressed:border-brand-line aria-pressed:bg-brand-tint aria-pressed:text-brand disabled:cursor-default disabled:text-ink-2 disabled:hover:bg-surface [&_svg]:pointer-events-none',
              className,
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

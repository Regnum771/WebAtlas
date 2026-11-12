import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge with the theme's own scales (packages/theme/tokens.json). Without them it
 * reads `text-body` as a colour and drops `text-ink` beside it, or keeps both of two heights.
 * Colours need no entry: any `bg-*`/`text-*` value that is not a known size counts as a colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['label', 'body', 'num', 'panel', 'page'],
      radius: ['sm', 'md', 'lg'],
      shadow: ['pop'],
      spacing: ['row', 'group-row', 'control-sm', 'control', 'header', 'gap'],
    },
  },
});

/** Joins class names, letting a later Tailwind class override an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

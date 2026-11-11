import type { Tokens } from './tokens';

/** WCAG 2.x relative luminance of a 6-digit hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, unrounded (1 to 21). */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The listed text/background pairs whose ratio falls below the floor. */
export function contrastFailures(
  tokens: Tokens,
  floor = 4.5,
): Array<{ fg: string; bg: string; ratio: number }> {
  return tokens.contrast
    .map(([fg, bg]) => ({ fg, bg, ratio: contrastRatio(tokens.color[fg], tokens.color[bg]) }))
    .filter((pair) => pair.ratio < floor);
}

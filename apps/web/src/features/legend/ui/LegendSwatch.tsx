import type { LegendEntry } from '@webatlas/shared';

/**
 * One legend swatch, drawn as the map draws the entry: a short line, a dot or a box. 3 px corners
 * on a box (spec "Corners"); a dot is the round status shape the rules allow.
 */
export function LegendSwatch({ entry }: { entry: LegendEntry | null | undefined }) {
  if (!entry) return <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-sm border border-line-2" />;
  const size = Math.min(entry.size ?? 12, 14);
  if (entry.shape === 'line') {
    return <span aria-hidden="true" data-shape="line" className="inline-block h-[3px] w-4 shrink-0" style={{ background: entry.swatch }} />;
  }
  return (
    <span
      aria-hidden="true"
      data-shape={entry.shape === 'dot' ? 'dot' : 'box'}
      className="inline-block shrink-0 data-[shape=box]:rounded-sm data-[shape=dot]:rounded-full"
      style={{ background: entry.swatch, width: size, height: size }}
    />
  );
}

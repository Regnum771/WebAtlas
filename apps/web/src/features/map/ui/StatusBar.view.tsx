import type { ReactNode, Ref } from 'react';

export interface StatusBarViewProps {
  /** The scale readout and the 11-stop slider (ScaleSlider). */
  scale: ReactNode;
  /** OpenLayers draws its scale line ("200 km") into this element. */
  scaleLineRef: Ref<HTMLDivElement>;
  /** OpenLayers draws the pointer's coordinates into this element. */
  coordinatesRef: Ref<HTMLDivElement>;
  /** The elevation under the pointer, when known. */
  elevation: ReactNode;
  /** The CRS the coordinates are shown in. */
  crs: ReactNode;
  /** Features selected for analysis (the analysis region), and what they are. */
  selection: { count: number; label: string | null };
}

const DIVIDER = 'border-l border-line-3 pl-3';

/**
 * The bottom edge of the map (R8): always there, never covered. In order: the scale readout and
 * slider, the scale line, the pointer's coordinates and elevation, the CRS, the selection count.
 * The scale line and the elevation give way first when the bar is narrow.
 */
export function StatusBarView({ scale, scaleLineRef, coordinatesRef, elevation, crs, selection }: StatusBarViewProps) {
  return (
    <div
      data-slot="status-bar"
      role="group"
      aria-label="Thanh trạng thái bản đồ"
      className="@container absolute inset-x-0 bottom-0 z-[45] flex h-control items-center gap-3 overflow-hidden border-t border-line bg-surface px-3 text-body text-ink"
    >
      {scale}
      <div
        ref={scaleLineRef}
        data-readout="scale-line"
        className={`${DIVIDER} hidden h-full items-center @[860px]:flex [&_.map-scaleline-inner]:border [&_.map-scaleline-inner]:border-t-0 [&_.map-scaleline-inner]:border-ink [&_.map-scaleline-inner]:px-0.5 [&_.map-scaleline-inner]:text-center [&_.map-scaleline-inner]:font-num [&_.map-scaleline-inner]:text-[10px] [&_.map-scaleline-inner]:leading-3`}
      />
      <div
        ref={coordinatesRef}
        data-readout="coordinates"
        aria-label="Toạ độ con trỏ"
        className={`${DIVIDER} min-w-[204px] font-num text-num whitespace-nowrap`}
      />
      <div data-readout="elevation" className="hidden @[960px]:block">{elevation}</div>
      <div data-readout="crs" className={`${DIVIDER} ml-auto min-w-0`}>{crs}</div>
      <output
        data-readout="selection"
        className={`${DIVIDER} whitespace-nowrap`}
        title={selection.label ?? undefined}
      >
        <span className="font-num text-num">{selection.count}</span> đối tượng
      </output>
    </div>
  );
}

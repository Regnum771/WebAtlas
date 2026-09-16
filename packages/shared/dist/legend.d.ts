export interface LegendEntry {
    swatch: string;
    shape: 'dot' | 'line' | 'box';
    label: string;
    /** Rendered diameter in px for 'dot' entries that encode magnitude. */
    size?: number;
}
export interface LegendSection {
    title: string;
    entries: LegendEntry[];
    note?: string;
}
/**
 * FABDEM (CC BY-NC-SA 4.0) attribution, required wherever elevation-derived data
 * surfaces. Kept as the exact sentence from docs/runbooks/elevation-dem.md and
 * terrain-contours.md — do not paraphrase, it is a licence condition.
 *
 * Exported (re-exported via index.ts) so this is the single source apps/web's
 * CONTOUR_ATTRIBUTION and tests import from, instead of hand-typing a second
 * literal copy that can drift (RE-REVIEW ROUND 2, R3).
 */
export declare const FABDEM_ATTRIBUTION = "FABDEM is produced using Copernicus WorldDEM-30 \u00A9 DLR e.V. 2010\u20132014 and \u00A9 Airbus Defence and Space GmbH 2014\u20132018.";
export declare const LEGEND_ATTRIBUTION: Record<string, string>;
/** Legend sections for a layer. Adding a layer means adding a case here —
 *  no JSX branches, no inline styles. */
export declare function legendFor(layerStateId: string): LegendSection[];

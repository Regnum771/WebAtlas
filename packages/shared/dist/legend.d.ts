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
/** Attribution required by the data licence, keyed by layerStateId.
 *  OSM data is ODbL and MUST carry this wherever the layer is shown. */
export declare const LEGEND_ATTRIBUTION: Record<string, string>;
/** Legend sections for a layer. Adding a layer means adding a case here —
 *  no JSX branches, no inline styles. */
export declare function legendFor(layerStateId: string): LegendSection[];

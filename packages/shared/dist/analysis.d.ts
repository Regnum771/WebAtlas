/**
 * The analysis wire contract: POST /api/analysis/:op returns an AnalysisResult,
 * and the assistant's analysis tools summarise the same shape.
 */
import type { EditableLayerKey } from './index.js';
import type { ResultGeometry } from './map-commands.js';
export declare const ANALYSIS_OPS: readonly ["buffer", "select_within", "nearest", "elevation_profile", "zonal_elevation"];
export type AnalysisOp = (typeof ANALYSIS_OPS)[number];
export interface AnalysisRow {
    layerKey?: EditableLayerKey;
    featureId?: string;
    name: string | null;
    lon?: number;
    lat?: number;
    distanceKm?: number;
}
export interface ProfileSample {
    distanceM: number;
    elevationM: number | null;
}
export interface AnalysisResult {
    op: AnalysisOp;
    /** Vietnamese label → value, rendered as rows in the result card and the print page. */
    summary: Record<string, number | string>;
    geometries: ResultGeometry[];
    /** ≤ 25 listed rows. */
    rows?: AnalysisRow[];
    profile?: ProfileSample[];
    attribution?: string;
    /** More matches existed than were drawn. */
    truncated?: boolean;
}

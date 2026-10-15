/**
 * The flood scenario demo's contract: a replay of the 26–31/10/2025 flood on Vu Gia – Thu Bồn
 * (KTTV bulletin of 21:00 28/10 read as "the forecast") and presets scaled from it. Shared by the
 * API, the assistant tools and the web dock. See
 * docs/superpowers/specs/2026-10-15-flood-scenario-demo-design.md.
 */
import type { GeoJsonGeometry } from './geometry.js';
export declare const FLOOD_SCENARIO_IDS: readonly ["kttv-2025-10", "preset-500", "preset-1000", "preset-1300"];
export type FloodScenarioId = (typeof FLOOD_SCENARIO_IDS)[number];
export declare function isFloodScenarioId(value: unknown): value is FloodScenarioId;
export interface FloodScenarioSummary {
    id: FloodScenarioId;
    name: string;
    kind: 'kttv' | 'preset';
    rainTotalMm: number | null;
    startTime: string;
    hours: number;
    bulletinHour: number;
    basis: string;
}
export interface FloodStation {
    id: string;
    name: string;
    river: string;
    bd1: number;
    bd2: number;
    bd3: number;
    recordM: number | null;
    recordYear: number | null;
    derived: boolean;
}
export interface FloodScenarioDetail extends FloodScenarioSummary {
    stations: FloodStation[];
    series: Record<string, {
        level: number[];
        forecast: (number | null)[];
    }>;
    floodedKm2: number[];
    /** EPSG:3857 minx, miny, maxx, maxy of every raster frame. */
    frameExtent: [number, number, number, number];
}
export interface FloodImpacts {
    hour: number;
    time: string;
    roads: {
        name: string | null;
        ref: string | null;
        fclass: string;
        cutHour: number;
        cutTime: string;
        maxDepth: number;
    }[];
    wards: {
        code: string;
        name: string;
        firstHour: number;
        firstTime: string;
        buildingsFlooded: number;
        peopleEst: number;
        maxDepth: number;
    }[];
    totals: {
        roadsCut: number;
        wardsWet: number;
        buildingsFlooded: number;
        peopleEst: number;
    };
}
export interface FloodPlanRow {
    priority: number;
    wardCode: string;
    wardName: string;
    deadlineHour: number;
    deadlineTime: string;
    alreadyWet: boolean;
    peopleEst: number;
    shelter: {
        id: string;
        name: string | null;
        kind: string;
        lonLat: [number, number];
    };
    distanceM: number;
    openRoads: string[];
    arrow: GeoJsonGeometry;
}
/** "HH:mm DD/MM/YYYY" in Vietnam time (fixed UTC+7) for `hour` hours after `startIso`. */
export declare function formatScenarioTime(startIso: string, hour: number): string;

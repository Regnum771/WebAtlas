/** Map a GeoJSON feature's properties to `{ column: value }`, excluding geometry. */
export type ColumnMap = (props: Record<string, unknown>, index: number) => Record<string, unknown>;
/**
 * How each seed file's properties become columns of its `water.<layer>` table. Here, beside the
 * layer keys and attribute definitions, so the API's seed command and the dataset pipeline's
 * load-geojson stage read one mapping and cannot drift (INV-4).
 *
 * `rivers` is not in this record: it loads from two files with two mappings, below.
 */
export declare const SEED_LAYER_COLUMNS: {
    dams: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        name_en: unknown;
        wattage_mw: unknown;
        annual_output: unknown;
        year_launched: unknown;
        year_operational: unknown;
        status: "binh_thuong" | "xa_lu" | "nguy_hiem";
    };
    stations: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        station_type: unknown;
        status: unknown;
        value: unknown;
    };
    flood_zones: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        hazard_type: unknown;
        area: unknown;
        risk_level: unknown;
    };
    drought_points: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        risk_level: unknown;
        status: unknown;
        survey_date: unknown;
    };
    saltwater_intrusion: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        salinity: unknown;
        risk_level: unknown;
        status: unknown;
    };
    flood_generation: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        risk_level: unknown;
        area: unknown;
        flow_rate: unknown;
    };
    lakes: (p: Record<string, unknown>) => {
        external_id: unknown;
        name: unknown;
        lake_type: unknown;
        area_km2: null;
        volume_mcm: null;
        shore_len_km: null;
    };
};
/**
 * OSM waterways as level-3 rows of water.rivers. Unlike HydroRIVERS, OSM has river names, and
 * `stream_order` here is a rank by waterway type, not a Strahler order.
 */
export declare const RIVER_WAY_COLUMNS: ColumnMap;
/**
 * HydroRIVERS reaches as level-2 rows of water.rivers. A reach row is the network edge: its
 * geometry is the span and flows_into_external_id its single outgoing adjacency.
 *
 * MAIN_RIV is in the seed file but deliberately not loaded: no column holds it, and overloading
 * `code` (the OSM waterway type at level 3) would make a column's meaning depend on the row's level.
 */
export declare const RIVER_REACH_COLUMNS: ColumnMap;

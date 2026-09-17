/**
 * Coordinate systems offered in the coordinate readout, the analysis results and the
 * print page. Display only: the map view stays EPSG:3857 and stored data EPSG:4326.
 *
 * VN-2000 datum parameters are copied verbatim from PostGIS spatial_ref_sys (EPSG
 * 4756/3405/3406), not typed from memory. TM-3 central meridians follow Thông tư
 * 973/2001/TT-TCĐC; provinces merged on 01/7/2025 keep one entry per former province,
 * because survey documents still cite the old province's meridian.
 */
export interface CrsOption {
    id: string;
    alias: string;
    kind: 'geographic' | 'projected';
    proj4: string;
    format?: 'dd' | 'dms';
}
export declare const DEFAULT_CRS_ID = "wgs84-dd";
export declare const CRS_OPTIONS: CrsOption[];
export declare function findCrs(id: string): CrsOption;

/** Map a GeoJSON feature's properties to { column: value }, excluding geometry. */
export type ColumnMap = (
  props: Record<string, unknown>,
  index: number
) => Record<string, unknown>;

/** Declared upstream provenance. ISO 19115 LI_Source. */
export interface LineageSource {
  citation: string;
  licence: string;
  uri?: string;
  resolution?: string;
}

/** ISO 19115 LI_Lineage. Process steps are appended by the runner, not declared. */
export interface Lineage {
  statement: string;
  licence: string;
  sources: LineageSource[];
}

export type Stage =
  | { type: 'fetch-http'; url: string; into: string; sha256?: string }
  | { type: 'load-geojson'; file: string; table: string; columns: ColumnMap }
  | { type: 'sql'; statement: string }
  | { type: 'publish-geoserver'; layer: string; style?: string }
  | {
      type: 'run';
      command: string;
      produces: string;
      /** Which built-in stage should eventually absorb this. */
      promoteTo: string;
      /** ISO date (YYYY-MM-DD). A past date fails the build — see Task 3. */
      promoteBy: string;
    };

export interface Dataset {
  id: string;
  kind: 'vector' | 'raster' | 'derived';
  lineage: Lineage;
  dependsOn?: string[];
  editable?: boolean;
  stages: Stage[];
}

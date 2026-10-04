import type { Pool } from 'pg';
import type { ColumnMap } from '@webatlas/shared';

export type { ColumnMap } from '@webatlas/shared';

/** One GeoJSON file of a load-geojson stage. */
export interface LoadGeojsonFile {
  /** Relative path: under packages/atlas-data/data by default, under the repo root when `root` is 'repo'. */
  file: string;
  root?: 'data' | 'repo';
  columns: ColumnMap;
  /** Non-versioned mode only: the schema-qualified table the file replaces, e.g. `admin.provinces`. */
  target?: string;
  /** Normalise a LineString or MultiLineString as MultiLineString. */
  multiLine?: boolean;
  /** Wrap a single Polygon as MultiPolygon. */
  multiPolygon?: boolean;
}

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
  | {
      type: 'fetch-http';
      url: string;
      /** A relative path inside packages/atlas-data/data/cache. */
      into: string;
      sha256?: string;
      /**
       * A regular expression (source text, anchored) over file names in the target's directory:
       * earlier downloads that this one replaces, removed once this one is in place. For a pinned
       * source whose file name carries the pin, so that moving the pin does not leave the old
       * file in the cache for good. Housekeeping only: it is not part of the stage's hash.
       */
      supersedes?: string;
    }
  | {
      type: 'load-geojson';
      /** The editable layer key (its table is `water.<layer>`), or a label for a non-versioned load. */
      layer: string;
      /** true: one ingest version per content (spec §11). false: the target tables are replaced. */
      versioned: boolean;
      files: LoadGeojsonFile[];
      /** The `source` string the old seed command wrote, so atlas:adopt can re-label that version. */
      legacySource?: string;
      /**
       * Which revision of the column mapping this is; 1 when omitted. A version is identified by
       * the content of its files AND this number, so bump it whenever a `columns` function or a
       * geometry flag changes what gets written: the same file is then loaded again as a new
       * version. A test pins each mapping's code so the change cannot go unnoticed.
       */
      mappingRevision?: number;
    }
  | { type: 'sql'; statement: string }
  | {
      type: 'publish-geoserver';
      /** The public layer name, e.g. `rivers` → `webatlas:rivers`. */
      layer: string;
      /** The relation behind it. Defaults to `<layer>_active`, the active-version view. */
      nativeName?: string;
      /** A default style to assign, by name. */
      style?: string;
    }
  | {
      type: 'run';
      /**
       * Where it executes (spec §7):
       * - 'host': `npm` on this machine, and `argv` is npm's arguments;
       * - 'tools': inside the atlas-tools container (Plan B), and `argv` is the container command.
       */
      in: 'host' | 'tools';
      /** An argument vector, never a command string: nothing is ever re-parsed by a shell. */
      argv: string[];
      produces: string;
      /** Which built-in stage should eventually absorb this. */
      promoteTo: string;
      /** ISO date (YYYY-MM-DD). A past date fails the build. */
      promoteBy: string;
    };

export interface Dataset {
  id: string;
  kind: 'vector' | 'raster' | 'derived';
  lineage: Lineage;
  dependsOn?: string[];
  editable?: boolean;
  stages: Stage[];
  probe?: Probe;
}

/** What a probe may look at: the database, and GeoServer (a GET of a path under GEOSERVER_URL). */
export interface ProbeContext {
  pool: Pool;
  geoserver: (path: string) => Promise<Response>;
}

/** Whether a dataset's output exists and serves, with a one-line account either way. */
export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/**
 * A cheap, read-only check of what a dataset produces (spec FR-13). One definition of "built" serves
 * both atlas:adopt (record an already-built machine) and atlas:verify (does it actually serve).
 */
export type Probe = (ctx: ProbeContext) => Promise<ProbeResult>;

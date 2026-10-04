import type { Pool } from 'pg';
import type { ColumnMap } from '@webatlas/shared';

export type { ColumnMap } from '@webatlas/shared';

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
    }
  | { type: 'load-geojson'; file: string; table: string; columns: ColumnMap }
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

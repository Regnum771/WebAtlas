/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * The catalogue (S1 of the catalogue-to-map plan, docs/superpowers/plans/2026-11-10-s1-catalogue-to-map.md).
 *
 * - catalogue.resources: one row per GeoNode resource the app shows in its Danh mục. The worker
 *   writes the row of a time series it registered (ruling R2); the Dagster sync keeps every row in
 *   step with GeoNode afterwards. managing_unit uses the P1 unit-code format (migration 25).
 * - catalogue.unit_for_bbox(): the managing unit of an extent, by the same rule as a feature's
 *   (admin.managing_unit_for over the provinces and wards the envelope intersects; the SQL of
 *   apps/api/src/modules/admin-units/repository.ts suggestManagingUnit).
 * - workspace.jobs.kind gains 'timeseries_import' (packages/atlas-data/tools/workspace/import_timeseries.py).
 * - workspace.files.purpose: 'timeseries' marks an upload made for the catalogue. Those files do not
 *   count toward the personal quota (ruling R1), so workspace.usage_bytes leaves them out.
 *
 * No grant to webatlas_assistant. The orchestrator's grants live in
 * infra/platform/postgis/platform-databases.sql (the role belongs to the platform stack).
 */
const UNIT_CODE_RE = '^(VN|[0-9]{2}|[0-9]{5})$';
const ROLE = 'webatlas_assistant';

// workspace.usage_bytes as migration 28 created it, with or without the purpose filter.
// CREATE OR REPLACE keeps the function's owner and grants (EXECUTE revoked from PUBLIC and the
// assistant in migration 28).
const usageBytes = (purposeFilter) => `
  CREATE OR REPLACE FUNCTION workspace.usage_bytes(p_owner uuid) RETURNS bigint
  LANGUAGE sql STABLE AS $fn$
    SELECT (
      COALESCE((SELECT sum(fl.size_bytes)
                  FROM workspace.files fl
                 WHERE fl.owner_id = p_owner${purposeFilter ? `
                   AND fl.purpose <> 'timeseries'` : ''}
                   AND (fl.delete_after IS NULL OR fl.delete_after > now())), 0)
      + COALESCE((SELECT sum(pg_column_size(f.geom) + pg_column_size(f.properties))
                    FROM workspace.features f
                    JOIN workspace.map_layers l ON l.id = f.layer_id
                    JOIN workspace.maps m ON m.id = l.map_id
                   WHERE m.owner_id = p_owner), 0)
    )::bigint
  $fn$;
`;

exports.up = (pgm) => {
  pgm.sql(`CREATE SCHEMA catalogue`);
  pgm.sql(`
    CREATE TABLE catalogue.resources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      geonode_pk integer NOT NULL UNIQUE,
      geonode_uuid uuid NOT NULL UNIQUE,
      alternate text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('vector', 'raster', 'timeseries', 'map', 'document')),
      title text NOT NULL,
      abstract text NOT NULL DEFAULT '',
      owner_sub text,
      managing_unit text NOT NULL CONSTRAINT resources_managing_unit_check CHECK (managing_unit ~ '${UNIT_CODE_RE}'),
      is_published boolean NOT NULL,
      is_approved boolean NOT NULL,
      variable text,
      unit text,
      time_steps timestamptz[],
      bbox4326 double precision[4] CONSTRAINT resources_bbox4326_check
        CHECK (bbox4326 IS NULL OR (cardinality(bbox4326) = 4 AND array_ndims(bbox4326) = 1)),
      origin text NOT NULL CHECK (origin IN ('geonode-upload', 'webatlas-upload', 'pipeline', 'map-publish')),
      synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX resources_owner_sub_idx ON catalogue.resources (owner_sub)`);
  pgm.sql(`CREATE INDEX resources_is_published_idx ON catalogue.resources (is_published)`);
  pgm.sql(`CREATE INDEX resources_title_trgm ON catalogue.resources USING gin (title gin_trgm_ops)`);

  // Positional parameters: a name such as `w` would also be read as a column of the wards.
  // SECURITY DEFINER with a fixed search_path: the orchestrator (platform-databases.sql) may run it
  // without any grant on the admin schema. PostGIS lives in public.
  pgm.sql(`
    CREATE FUNCTION catalogue.unit_for_bbox(w float8, s float8, e float8, n float8) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
      WITH g AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom)
      SELECT admin.managing_unit_for(
               ARRAY(SELECT p.code FROM admin.provinces p, g WHERE ST_Intersects(g.geom, p.geom) ORDER BY p.code),
               ARRAY(SELECT wd.code FROM admin.wards wd, g WHERE ST_Intersects(g.geom, wd.geom) ORDER BY wd.code)
             )
    $fn$
  `);
  // A new function is executable by PUBLIC; a new schema and table grant nothing.
  pgm.sql(`REVOKE ALL ON FUNCTION catalogue.unit_for_bbox(float8, float8, float8, float8) FROM PUBLIC, ${ROLE}`);
  pgm.sql(`REVOKE ALL ON SCHEMA catalogue FROM PUBLIC, ${ROLE}`);
  pgm.sql(`REVOKE ALL ON TABLE catalogue.resources FROM PUBLIC, ${ROLE}`);

  pgm.sql(`
    ALTER TABLE workspace.jobs DROP CONSTRAINT jobs_kind_check;
    ALTER TABLE workspace.jobs ADD CONSTRAINT jobs_kind_check
      CHECK (kind IN ('import', 'export', 'timeseries_import'));
  `);
  pgm.sql(`
    ALTER TABLE workspace.files ADD COLUMN purpose text NOT NULL DEFAULT 'map'
      CONSTRAINT files_purpose_check CHECK (purpose IN ('map', 'timeseries'))
  `);
  pgm.sql(usageBytes(true));
};

exports.down = (pgm) => {
  // The old function first: it must not name the column dropped below.
  pgm.sql(usageBytes(false));
  pgm.sql(`ALTER TABLE workspace.files DROP COLUMN purpose`);
  // The old check refuses time-series jobs, so their history goes with the job kind.
  pgm.sql(`
    DELETE FROM workspace.jobs WHERE kind = 'timeseries_import';
    ALTER TABLE workspace.jobs DROP CONSTRAINT jobs_kind_check;
    ALTER TABLE workspace.jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('import', 'export'));
  `);
  pgm.sql(`DROP FUNCTION catalogue.unit_for_bbox(float8, float8, float8, float8)`);
  pgm.sql(`DROP TABLE catalogue.resources`);
  pgm.sql(`DROP SCHEMA catalogue`);
};

/* eslint-disable camelcase */
exports.shorthands = undefined;

// Verbatim copy of migration 1000000000005's generated view for `rivers`. A view's
// SELECT * is expanded at creation time, so this text is the view's real contract.
const RIVERS_ACTIVE = `
  CREATE VIEW water.rivers_active AS
  WITH RECURSIVE active AS (
    SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active
  ),
  chain AS (
    SELECT v.id, v.parent_version_id, 0 AS depth
      FROM app.dataset_versions v JOIN active a ON v.id = a.id
    UNION ALL
    SELECT p.id, p.parent_version_id, c.depth + 1
      FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
  ),
  resolved AS (
    SELECT DISTINCT ON (t.external_id) t.*
      FROM water.rivers t JOIN chain c ON t.dataset_version_id = c.id
      ORDER BY t.external_id, c.depth
  )
  SELECT * FROM resolved WHERE NOT deleted;
`;

// Verbatim copy of migration 1000000000009. Migration 20 replaces this with a plain
// view over level 1; it is recreated here so THIS migration is self-contained and
// reversible on its own.
const RIVERS_OVERVIEW = `
  CREATE MATERIALIZED VIEW water.rivers_overview AS
    SELECT COALESCE(name, '') AS name_key,
           name,
           5 AS stream_order,
           ST_LineMerge(ST_Collect(ST_SimplifyPreserveTopology(geom, 0.01))) AS geom
      FROM water.rivers_active
     WHERE stream_order = 5
     GROUP BY COALESCE(name, ''), name
`;
const OVERVIEW_INDEXES = [
  `CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`,
  `CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`,
];

// DROP VIEW + CREATE VIEW makes water.rivers_active a brand-new object, so the SELECT
// grant migration 1000000000008 gave webatlas_assistant on it does not survive — the
// same hazard migration 1000000000016's down() documents and re-grants for. Re-granting
// here keeps the assistant's read access to this view intact across the type change.
const REGRANT_ASSISTANT = `GRANT SELECT ON water.rivers_active TO webatlas_assistant;`;

exports.up = (pgm) => {
  // Postgres refuses the type change while any view depends on the column:
  //   ERROR:  cannot alter type of a column used by a view or rule
  //   DETAIL: rule _RETURN on view water.rivers_active depends on column "external_id"
  // rivers_overview reads rivers_active, so it goes first. The per-version unique
  // index on (dataset_version_id, external_id) is rebuilt by Postgres automatically.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.sql(`
    ALTER TABLE water.rivers
      ALTER COLUMN external_id TYPE text
      USING CASE WHEN external_id IS NULL THEN NULL
                 ELSE 'osm:' || external_id::text END
  `);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
  pgm.sql(REGRANT_ASSISTANT);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  // Refuse rather than silently destroy: an 'edit:<uuid>' id from a steward-created
  // river, or a 'hyriv:'/'river:' id from a later task, has no integer form. Losing a
  // feature to keep a down-migration tidy is the worse trade, so say so and stop.
  pgm.sql(`
    DO $$
    DECLARE n bigint;
    BEGIN
      SELECT count(*) INTO n FROM water.rivers
       WHERE external_id IS NOT NULL AND external_id !~ '^osm:[0-9]+$';
      IF n > 0 THEN
        RAISE EXCEPTION
          'cannot revert 1000000000018: % water.rivers rows have a non-osm external_id', n;
      END IF;
    END $$;
  `);
  pgm.sql(`
    ALTER TABLE water.rivers
      ALTER COLUMN external_id TYPE integer
      USING CASE WHEN external_id IS NULL THEN NULL
                 ELSE substring(external_id from 5)::integer END
  `);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
  pgm.sql(REGRANT_ASSISTANT);
};

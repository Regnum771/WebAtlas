/* eslint-disable camelcase */
exports.shorthands = undefined;

// Verbatim copy of migration 1000000000018's generated view for `rivers`. A view's
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

// Verbatim copy of migration 1000000000018.
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

// DROP VIEW discards every privilege granted on that view object; CREATE, even of an
// identical definition, makes a NEW object that starts with none. Migration
// 1000000000008 granted webatlas_assistant SELECT on water.rivers_active, so without
// this re-grant the assistant silently loses read access to rivers. Migration
// 1000000000016 hit this first and documents it; migration 1000000000018 (Task 1) hit it
// again. No existing test catches it — privileges.test.ts asserts against dams_active.
const REGRANT_ASSISTANT = `GRANT SELECT ON water.rivers_active TO webatlas_assistant;`;

const TBL = { schema: 'water', name: 'rivers' };

exports.up = (pgm) => {
  pgm.addColumns(TBL, {
    // DEFAULT 3 is deliberate and stays. insertIntoVersion (modules/layers/repository.ts)
    // builds its column list from the registry's attribute columns and never mentions
    // feature_level, so a NOT NULL column without a default would break every
    // steward-created river. The default also encodes the real editing rule: a steward
    // draws an OSM-style way, which IS level 3. Ingests and the level-1 builder set the
    // level explicitly.
    feature_level: { type: 'smallint', notNull: true, default: 3 },
    // Composition: "what is this part of". way -> river, reach -> river.
    parent_external_id: { type: 'text' },
    // Hydrology: "where does the water go". reach -> reach, river -> river.
    // Separate from parent_external_id so neither column's meaning depends on the row's
    // level, and no query has to know which sense it is reading.
    flows_into_external_id: { type: 'text' },
    // 0..1 for a computed parent link. A bad join stays visible instead of silent.
    match_confidence: { type: 'real' },
  });
  pgm.addConstraint(TBL, 'rivers_feature_level_check', { check: 'feature_level IN (1, 2, 3)' });
  pgm.createIndex(TBL, 'feature_level');
  pgm.createIndex(TBL, 'parent_external_id');
  pgm.createIndex(TBL, 'flows_into_external_id');

  // The view must be recreated or the new columns are invisible to every reader: a
  // view's SELECT * is expanded when the view is created, not when it is queried.
  // rivers_overview depends on rivers_active, so it is dropped first and rebuilt after.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
  pgm.sql(REGRANT_ASSISTANT);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.dropConstraint(TBL, 'rivers_feature_level_check');
  pgm.dropColumns(TBL, [
    'feature_level', 'parent_external_id', 'flows_into_external_id', 'match_confidence',
  ]);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
  pgm.sql(REGRANT_ASSISTANT);
};

/* eslint-disable camelcase */
exports.shorthands = undefined;

// water.rivers holds three levels since the topology ingest (1 = river entity, 2 =
// HydroRIVERS reach, 3 = OSM way), and rivers_active returns all three. Each consumer has
// to say which level it means; these two views are the map's answer.

// The materialised view as migration 1000000000019 last built it, for `down`.
const OLD_OVERVIEW = `
  CREATE MATERIALIZED VIEW water.rivers_overview AS
    SELECT COALESCE(name, '') AS name_key,
           name,
           5 AS stream_order,
           ST_LineMerge(ST_Collect(ST_SimplifyPreserveTopology(geom, 0.01))) AS geom
      FROM water.rivers_active
     WHERE stream_order = 5
     GROUP BY COALESCE(name, ''), name
`;

// A new view starts with no privileges (migrations 16, 18 and 19 each hit this). The
// assistant reads rivers through rivers_active already; grant it the per-level views too.
const GRANT_ASSISTANT = `
  GRANT SELECT ON water.rivers_detail, water.rivers_overview TO webatlas_assistant
`;

exports.up = (pgm) => {
  // The materialised view goes, and with it refreshRiverOverview and the standing
  // obligation to remember it. Migration 1000000000009's own comment warns that
  // activating a version without refreshing leaves the far-zoom map serving old data
  // in silence; a plain view cannot have that bug.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);

  // Level 3 only: what the detailed map layer and the editor mean by "a river".
  pgm.sql(`
    CREATE VIEW water.rivers_detail AS
      SELECT * FROM water.rivers_active WHERE feature_level = 3
  `);

  // Same name, same columns, same WFS typename as the matview it replaces, so apps/web
  // needs no change -- but now the real level-1 entities rather than name-grouped
  // stream_order = 5 fragments.
  //
  // Only rivers with at least one OSM waterway=river way (stream_order 5 at level 3):
  // 324 of the 588 (278 names), the same set the old matview drew and the same rule the
  // detailed layer's style applies at far scales (apps/web styles.ts, riverBucket). With
  // all 588, the far-zoom map drew every named suối as a main river, and zooming in past
  // the handoff made most of them vanish (seen in the browser, 2026-09-29).
  //
  // Simplified at the old matview's 0.01 degrees (~1.1 km; the layer only draws below
  // zoom 8.5). Measured 2026-09-29 over all 588 rivers: 5.1 MB of GeoJSON unsimplified
  // (5.4 MB over WFS), 115 kB at 0.005, 73 kB at 0.01, with no river simplified away.
  pgm.sql(`
    CREATE VIEW water.rivers_overview AS
      SELECT COALESCE(name, '') AS name_key, name, stream_order,
             ST_SimplifyPreserveTopology(geom, 0.01) AS geom
        FROM water.rivers_active
       WHERE feature_level = 1
         AND external_id IN (SELECT parent_external_id FROM water.rivers_active
                              WHERE feature_level = 3 AND stream_order = 5)
  `);
  pgm.sql(GRANT_ASSISTANT);
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_detail`);
  pgm.sql(OLD_OVERVIEW);
  pgm.sql(`CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`);
  pgm.sql(`CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`);
};

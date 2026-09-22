/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * basemap.reference_entities — the dissolved named entities of spec §4.
 *
 * WHY A MIGRATION OWNS THIS TABLE, NOT THE LOADER
 * `scripts/basemap/load_basemap.py` writes with GeoPandas
 * `to_postgis(..., if_exists="replace")`, which DROPS and recreates each table it
 * loads. Anything created on those tables by a migration — a trigram index, a
 * constraint — silently disappears on the next basemap load. This table is not one
 * the loader writes, so it survives, which makes it the only safe home for the
 * trigram index that search depends on.
 *
 * It also means search should hit the dissolved entities rather than the raw
 * segments: "Quốc lộ 14" is one entity over ~3k road rows, and one hit is the
 * useful answer. So there is deliberately NO trigram index on basemap.roads_region
 * and friends; the builder's one-off sequential scan needs none.
 *
 * ONE WRITER: apps/api/src/db/referenceEntities.ts. Unlike the water layers there
 * is no edit path, so the derived table has exactly one writer and is rebuilt whole
 * per layer.
 *
 * NO GRANT to webatlas_assistant. Migration 8 deliberately withholds USAGE on the
 * basemap schema so `run_sql` cannot reach it; this table stays behind that line,
 * and assistant access to reference layers is by typed tools on the app pool.
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS basemap;');

  pgm.sql(`
    CREATE TABLE basemap.reference_entities (
      -- '<layer_key>:<md5(entity_key)>:<cluster_id>' — deterministic, so an entity
      -- keeps its id across rebuilds as long as its name/ref and cluster hold.
      entity_id    text PRIMARY KEY,
      layer_key    text NOT NULL,
      -- coalesce(ref, name): the dissolve key.
      entity_key   text NOT NULL,
      -- ST_ClusterDBSCAN group within entity_key: two roads sharing a ref but far
      -- apart are two entities, not one sprawling multipart geometry.
      cluster_id   integer NOT NULL,
      name         text,
      ref          text,
      fclass       text,
      member_ids   text[] NOT NULL,
      member_count integer NOT NULL,
      -- Summed values for the registry's summable columns, e.g. {"population": 51234}.
      attrs        jsonb NOT NULL DEFAULT '{}'::jsonb,
      geom         geometry(Geometry, 4326) NOT NULL,
      built_at     timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    ALTER TABLE basemap.reference_entities
      ADD CONSTRAINT reference_entities_natural_key UNIQUE (layer_key, entity_key, cluster_id);
  `);

  pgm.sql('CREATE INDEX reference_entities_geom_idx ON basemap.reference_entities USING GIST (geom);');
  pgm.sql('CREATE INDEX reference_entities_layer_idx ON basemap.reference_entities (layer_key);');
  pgm.sql('CREATE INDEX reference_entities_fclass_idx ON basemap.reference_entities (layer_key, fclass);');

  // The search path. pg_trgm is installed by migration 7.
  pgm.sql(`
    CREATE INDEX reference_entities_name_trgm_idx
      ON basemap.reference_entities USING GIN (name gin_trgm_ops);
  `);
  pgm.sql(`
    CREATE INDEX reference_entities_ref_trgm_idx
      ON basemap.reference_entities USING GIN (ref gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS basemap.reference_entities;');
  // The basemap schema itself is not dropped: load_basemap.py's tables live there
  // and this migration did not create them.
};

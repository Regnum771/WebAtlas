/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * The active state of each thematic layer, stored instead of computed (S1 spec,
 * docs/superpowers/specs/2026-10-04-active-data-current-flag-design.md).
 *
 * Until now every water.<layer>_active view walked the active version chain and kept the
 * nearest row per external_id on every read, before any predicate applied: an optimizer
 * fence. A map window returning 65 lakes took 1.4 s. From here on the answer is stored on
 * the rows as is_current, maintained by versionsService.activate() (packages/versioning),
 * and each view is a plain filter that PostgreSQL inlines, so a caller's predicate reaches
 * the partial indexes created below.
 *
 * The backfill writes data, an exception to "migrations create tables, the pipeline
 * populates": without it the views would return nothing until each layer's next activation.
 */
const LAYERS = [
  'dams', 'stations', 'flood_zones', 'drought_points',
  'saltwater_intrusion', 'flood_generation', 'lakes', 'rivers',
];
const LAYER_ARRAY = `ARRAY[${LAYERS.map((l) => `'${l}'`).join(', ')}]`;

exports.up = (pgm) => {
  // Distinct times for versions created in one transaction: retention orders loads by
  // ingested_at, and now() is frozen for the whole transaction.
  pgm.sql(`ALTER TABLE app.dataset_versions ALTER COLUMN ingested_at SET DEFAULT clock_timestamp()`);

  // Per layer, in this order: the column; the backfill, through the old view while it still
  // resolves; the view replaced, with the column list read from the old view so names and
  // order stay exactly as they were (rivers_detail and rivers_overview select from
  // rivers_active); then the partial indexes.
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active';
        EXECUTE format('ALTER TABLE water.%I ADD COLUMN is_current boolean NOT NULL DEFAULT false', l);
        EXECUTE format('UPDATE water.%I SET is_current = true WHERE id IN (SELECT id FROM water.%I)', l, l || '_active');
        EXECUTE format('CREATE OR REPLACE VIEW water.%I AS SELECT %s FROM water.%I WHERE is_current', l || '_active', cols, l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gist (geom) WHERE is_current', l || '_current_geom_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (province_codes) WHERE is_current', l || '_current_province_codes_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (ward_codes) WHERE is_current', l || '_current_ward_codes_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (name gin_trgm_ops) WHERE is_current', l || '_current_name_trgm', l);
        EXECUTE format('CREATE INDEX %I ON water.%I (external_id) WHERE is_current', l || '_current_external_id_idx', l);
        EXECUTE format('ANALYZE water.%I', l);
      END LOOP;
    END $$;
  `);

  // Versions a scenario (S4) branched from. Pruning never removes a pinned version or its
  // ancestors, and RESTRICT is the second guard.
  pgm.sql(`
    CREATE TABLE app.version_pins (
      version_id uuid NOT NULL REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
      holder text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (version_id, holder)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS app.version_pins`);
  // The resolving views as migrations 5, 6, 18 and 19 left them, with an explicit column list
  // (not t.*) so that is_current can be dropped afterwards.
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
      tcols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
               string_agg('t.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
          INTO cols, tcols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active';
        EXECUTE format($v$
          CREATE OR REPLACE VIEW water.%I AS
          WITH RECURSIVE active AS (
            SELECT id FROM app.dataset_versions WHERE layer_key = %L AND is_active
          ),
          chain AS (
            SELECT v.id, v.parent_version_id, 0 AS depth
              FROM app.dataset_versions v JOIN active a ON v.id = a.id
            UNION ALL
            SELECT p.id, p.parent_version_id, c.depth + 1
              FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
          ),
          resolved AS (
            SELECT DISTINCT ON (t.external_id) %s
              FROM water.%I t JOIN chain c ON t.dataset_version_id = c.id
             ORDER BY t.external_id, c.depth
          )
          SELECT %s FROM resolved WHERE NOT deleted
        $v$, l || '_active', l, tcols, l, cols);
        EXECUTE format('DROP INDEX IF EXISTS water.%I, water.%I, water.%I, water.%I, water.%I',
          l || '_current_geom_idx', l || '_current_province_codes_idx', l || '_current_ward_codes_idx',
          l || '_current_name_trgm', l || '_current_external_id_idx');
        EXECUTE format('ALTER TABLE water.%I DROP COLUMN is_current', l);
      END LOOP;
    END $$;
  `);
  pgm.sql(`ALTER TABLE app.dataset_versions ALTER COLUMN ingested_at SET DEFAULT now()`);
};

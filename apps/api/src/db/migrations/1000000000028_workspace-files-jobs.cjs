/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Files, jobs and the storage quota (P3b of docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md),
 * plus the SQL functions that the TypeScript API and the Python GDAL worker both call, so that
 * each rule exists once.
 *
 * - files: every stored file (an upload, the COG made from an uploaded GeoTIFF, an export). path
 *   is relative to the file store root. delete_after is set on files that expire (exports); an
 *   expired file no longer counts toward the quota, whether or not it has been removed yet.
 * - jobs: import/export work queued by the API and run by the worker. heartbeat_at lets a stale
 *   running job be failed. The partial index serves the worker's "oldest queued job" pick.
 * - map_layers.file_id / raster: a raster layer's COG and its display metadata.
 * - app.users.quota_bytes: 1 GiB by default; admin can change it.
 *
 * Functions:
 * - bump_map: record a change to a map's content (was the body of access.ts bumpMap).
 * - usage_bytes: what counts against the quota.
 * - edit_copy_rows: the rows an edit-copy layer shows (was featuresRepository.editCopyFeaturesInBBox).
 *
 * No grant to webatlas_assistant, and no EXECUTE for PUBLIC.
 */
const ROLE = 'webatlas_assistant';
const S = 'workspace';
const FUNCTIONS = [
  `${S}.bump_map(uuid)`,
  `${S}.usage_bytes(uuid)`,
  `${S}.edit_copy_rows(regclass, regclass, uuid, text, text[], geometry, integer)`,
];

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'app', name: 'users' }, {
    quota_bytes: { type: 'bigint', notNull: true, default: 1073741824, check: 'quota_bytes >= 0' },
  });

  pgm.createTable({ schema: S, name: 'files' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: { type: 'uuid', notNull: true, references: { schema: 'app', name: 'users' }, onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: `kind IN ('upload', 'cog', 'export')` },
    path: { type: 'text', notNull: true, unique: true },
    original_name: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'bigint', notNull: true, check: 'size_bytes >= 0' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    delete_after: { type: 'timestamptz' },
  });
  pgm.createIndex({ schema: S, name: 'files' }, 'owner_id', { name: 'files_owner_idx' });

  pgm.createTable({ schema: S, name: 'jobs' }, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_id: { type: 'uuid', notNull: true, references: { schema: 'app', name: 'users' }, onDelete: 'CASCADE' },
    map_id: { type: 'uuid', references: { schema: S, name: 'maps' }, onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true, check: `kind IN ('import', 'export')` },
    status: {
      type: 'text', notNull: true, default: 'queued',
      check: `status IN ('queued', 'running', 'succeeded', 'failed')`,
    },
    params: { type: 'jsonb', notNull: true },
    steps: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
    progress: { type: 'integer', notNull: true, default: 0, check: 'progress BETWEEN 0 AND 100' },
    result: { type: 'jsonb' },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    heartbeat_at: { type: 'timestamptz' },
  });
  pgm.createIndex({ schema: S, name: 'jobs' }, 'created_at', {
    name: 'jobs_queued_idx',
    where: `status = 'queued'`,
  });

  pgm.addColumns({ schema: S, name: 'map_layers' }, {
    file_id: { type: 'uuid', references: { schema: S, name: 'files' }, onDelete: 'SET NULL' },
    raster: { type: 'jsonb' },
  });
  pgm.addConstraint({ schema: S, name: 'map_layers' }, 'map_layers_raster_check', {
    check: `kind <> 'raster' OR raster IS NOT NULL`,
  });

  // Exactly the UPDATE access.ts bumpMap ran: next revision, fresh activity, notice cleared.
  // NULL when there is no such map (the caller turns that into its 404).
  pgm.sql(`
    CREATE FUNCTION ${S}.bump_map(p_map uuid) RETURNS integer
    LANGUAGE sql VOLATILE AS $fn$
      UPDATE workspace.maps
         SET revision = revision + 1,
             updated_at = now(),
             last_activity_at = now(),
             inactivity_notice_at = NULL
       WHERE id = p_map
      RETURNING revision
    $fn$;
  `);

  // The owner's live files (no delete_after, or one still in the future) plus the stored size of
  // the features of all their maps, archived ones included: the byte rule of
  // cleanup.ts adminSummary. Only free layers store rows in workspace.features, so every row
  // counted here is a free feature.
  pgm.sql(`
    CREATE FUNCTION ${S}.usage_bytes(p_owner uuid) RETURNS bigint
    LANGUAGE sql STABLE AS $fn$
      SELECT (
        COALESCE((SELECT sum(fl.size_bytes)
                    FROM workspace.files fl
                   WHERE fl.owner_id = p_owner
                     AND (fl.delete_after IS NULL OR fl.delete_after > now())), 0)
        + COALESCE((SELECT sum(pg_column_size(f.geom) + pg_column_size(f.properties))
                      FROM workspace.features f
                      JOIN workspace.map_layers l ON l.id = f.layer_id
                      JOIN workspace.maps m ON m.id = l.map_id
                     WHERE m.owner_id = p_owner), 0)
      )::bigint
    $fn$;
  `);

  // An edit copy's rows, as featuresRepository.editCopyFeaturesInBBox read them: the official
  // relation's rows (p_relation: a layer's _active view, or water.rivers_detail) minus the
  // features the draft holds a row for, plus the draft's own live rows from the base table
  // (p_table). Each half is filtered with && p_bbox when one is given, so both reach the
  // layer's geometry indexes. Ordered by the row id in its own type, then capped by p_limit.
  //
  // Identifiers reach the SQL text only as regclass output (which quotes and qualifies itself)
  // or through %I; p_columns names also go into the properties object as %L literals. Values
  // travel as parameters.
  pgm.sql(`
    CREATE FUNCTION ${S}.edit_copy_rows(
      p_table regclass, p_relation regclass, p_draft uuid, p_geom text, p_columns text[],
      p_bbox geometry DEFAULT NULL, p_limit integer DEFAULT NULL
    ) RETURNS TABLE (id text, geometry jsonb, properties jsonb)
    LANGUAGE plpgsql STABLE AS $fn$
    DECLARE
      v_geom text := format('%I', p_geom);
      v_pick_a text;
      v_pick_d text;
      v_attrs text;
      v_bbox_a text := '';
      v_bbox_d text := '';
    BEGIN
      SELECT concat_ws(', ', 'a.id', 'a.external_id', 'a.' || v_geom,
                       string_agg(format('a.%I', c), ', ' ORDER BY o)),
             concat_ws(', ', 'd.id', 'd.external_id', 'd.' || v_geom,
                       string_agg(format('d.%I', c), ', ' ORDER BY o)),
             string_agg(format(', %L, t.%I', c, c), '' ORDER BY o)
        INTO v_pick_a, v_pick_d, v_attrs
        FROM unnest(p_columns) WITH ORDINALITY AS u(c, o);
      IF p_bbox IS NOT NULL THEN
        v_bbox_a := format(' AND a.%s && $2', v_geom);
        v_bbox_d := format(' AND d.%s && $2', v_geom);
      END IF;
      RETURN QUERY EXECUTE format(
        $q$SELECT t.id::text,
                  CASE WHEN t.%1$s IS NULL THEN NULL ELSE ST_AsGeoJSON(t.%1$s)::jsonb END,
                  jsonb_build_object('external_id', t.external_id::text%2$s)
             FROM (
               SELECT %3$s FROM %5$s a
                WHERE NOT EXISTS (SELECT 1 FROM %6$s d
                                   WHERE d.dataset_version_id = $1 AND d.external_id = a.external_id)%7$s
               UNION ALL
               SELECT %4$s FROM %6$s d
                WHERE d.dataset_version_id = $1 AND NOT d.deleted%8$s
             ) t
            ORDER BY t.id
            LIMIT $3
        $q$,
        v_geom, COALESCE(v_attrs, ''), v_pick_a, v_pick_d, p_relation, p_table, v_bbox_a, v_bbox_d)
      USING p_draft, p_bbox, p_limit;
    END
    $fn$;
  `);

  pgm.sql(`REVOKE ALL ON TABLE ${S}.files, ${S}.jobs FROM PUBLIC, ${ROLE};`);
  pgm.sql(`REVOKE ALL ON FUNCTION ${FUNCTIONS.join(', ')} FROM PUBLIC, ${ROLE};`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION ${FUNCTIONS.join(', ')};`);
  pgm.dropConstraint({ schema: S, name: 'map_layers' }, 'map_layers_raster_check');
  pgm.dropColumns({ schema: S, name: 'map_layers' }, ['file_id', 'raster']);
  pgm.dropTable({ schema: S, name: 'jobs' });
  pgm.dropTable({ schema: S, name: 'files' });
  pgm.dropColumn({ schema: 'app', name: 'users' }, 'quota_bytes');
};

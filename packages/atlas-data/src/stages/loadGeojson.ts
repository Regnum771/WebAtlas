import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { EDITABLE_LAYER_KEYS, type ColumnMap, type EditableLayerKey } from '@webatlas/shared';
import { loadFeatures, pruneVersions, stampAdminCodes, versionsService } from '@webatlas/versioning';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { resolveStageFile } from '../paths';
import { versionSource } from '../fileHash';
import { adoptLegacySource } from '../adoptLegacy';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

/** A load-geojson stage with its files resolved to absolute paths and its content source computed. */
export interface ResolvedLoad {
  layer: string;
  versioned: boolean;
  /** `<file names>@sha256:<hash of the file hashes>` (spec §11). Unused in non-versioned mode. */
  source: string;
  /** `mapping-<n>`: the revision of the column mapping, the other half of a version's identity. */
  mapping: string;
  /** The source string the old seed command wrote for this layer, if it had one. */
  legacySource?: string;
  files: Array<{ path: string; columns: ColumnMap; target?: string; multiLine?: boolean; multiPolygon?: boolean }>;
}

export interface LoadOutcome {
  /** loaded: a new ingest version. restamped: unchanged content. replaced: non-versioned tables. */
  action: 'loaded' | 'restamped' | 'replaced';
  summary: string;
  /** The root of the active chain after the call (versioned mode). */
  versionId?: string;
}

export function resolveLoad(stage: LoadStage): ResolvedLoad {
  return {
    layer: stage.layer,
    versioned: stage.versioned,
    source: versionSource(stage),
    mapping: `mapping-${stage.mappingRevision ?? 1}`,
    legacySource: stage.legacySource,
    files: stage.files.map((f) => ({
      path: resolveStageFile(f),
      columns: f.columns,
      target: f.target,
      multiLine: f.multiLine,
      multiPolygon: f.multiPolygon,
    })),
  };
}

const isEditable = (layer: string): layer is EditableLayerKey =>
  (EDITABLE_LAYER_KEYS as readonly string[]).includes(layer);

/** The layer's active version and its chain down to the root ingest, nearest first. On `client`. */
async function activeChain(
  client: PoolClient,
  layer: string
): Promise<Array<{ id: string; kind: string; source: string }>> {
  const { rows } = await client.query<{ id: string; kind: string; source: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, kind, source, parent_version_id, 0 AS depth
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       UNION ALL
       SELECT v.id, v.kind, v.source, v.parent_version_id, c.depth + 1
         FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
     )
     SELECT id, kind, source FROM chain ORDER BY depth`,
    [layer]
  );
  return rows;
}

async function loadVersioned(
  pool: Pool,
  client: PoolClient,
  load: ResolvedLoad,
  opts: { supersedeEdits: boolean }
): Promise<LoadOutcome> {
  // Take the layer's version rows before looking at them. Committing an edit session flips the
  // active pointer, which needs the same row: it now waits for this load, and if this load
  // activates a new version the edit's own activation then fails on the one-active-version index.
  // Without the lock an edit committed during the load (rivers takes about 40 s) would be
  // deactivated by it, unseen by the guard below.
  await client.query(`SELECT id FROM app.dataset_versions WHERE layer_key = $1 FOR UPDATE`, [load.layer]);

  // Is what the layer rests on already this load? Either under the current labels, or under an
  // older one that is re-labelled here (a machine that never ran atlas:adopt): then there is
  // nothing to load, and no reason to stop for edits that sit on the very same content.
  const adoption = await adoptLegacySource(client, load);
  const chain = await activeChain(client, load.layer);

  // Unchanged: create nothing, activate nothing. The boundaries may have changed (they are upstream
  // of every layer), so every version of the chain gets its administrative codes again (spec C-5).
  if (adoption.result !== 'mismatch') {
    let pruned = '';
    if (isEditable(load.layer)) {
      for (const v of chain) await stampAdminCodes(client, load.layer, v.id);
      // Nothing is activated here, so retention would otherwise wait for the next real load: an
      // existing machine's backlog goes on its next build instead. Under the layer lock taken above.
      const p = await pruneVersions(client, load.layer);
      if (p.versions > 0) pruned = `; pruned ${p.versions} old version${p.versions === 1 ? '' : 's'} (${p.rows} rows)`;
    }
    const relabelled = adoption.result === 'relabelled' ? ' (existing version re-labelled)' : '';
    return {
      action: 'restamped',
      versionId: adoption.versionId,
      summary: `${load.layer}: content unchanged${relabelled}; re-stamped ${chain.length} version${chain.length === 1 ? '' : 's'}${pruned}`,
    };
  }

  // New content, or the same file under a new mapping revision. Edits sit on top of the previous
  // load: replacing it would hide them, and nothing replays them yet. Only an explicit
  // --supersede-edits may do that; --force never does.
  if (chain[0]?.kind === 'edit' && !opts.supersedeEdits) {
    throw new Error(
      `${load.layer} has steward edits on top of its last load; loading new content would hide them. ` +
        `Re-run with --supersede-edits ${load.layer} to proceed.`
    );
  }

  const versions = versionsService(pool);
  const versionId = await versions.createIngestVersion(client, {
    layerKey: load.layer,
    source: load.source,
    sourceVersion: load.mapping,
  });
  for (const f of load.files) {
    await loadFeatures(
      client,
      { table: load.layer, file: f.path, columns: f.columns, multiLine: f.multiLine, multiPolygon: f.multiPolygon },
      versionId
    );
  }
  // activate() owns the layer's obligations: river hierarchy and gates, then administrative codes.
  await versions.activate(client, load.layer, versionId);
  // Counted after activation: for rivers it inserts the derived level-1 rows into this version.
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.${load.layer} WHERE dataset_version_id = $1`,
    [versionId]
  );
  await client.query(`UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`, [rows[0].n, versionId]);
  // Autovacuum gets to a freshly filled table about a minute later, and until then the planner has
  // no statistics for it. Measured on rivers: a self-join over the active view took 72 s, and 11 s
  // once analysed. After activation, so the rows it derives are counted too.
  await client.query(`ANALYZE water.${load.layer}`);
  return {
    action: 'loaded',
    versionId,
    summary: `${load.layer}: ${rows[0].n} features in a new version from ${load.source} (${load.mapping})`,
  };
}

/** Insert every feature of the file into `target` (schema.table, validated by the descriptor schema). */
async function insertPlain(
  client: PoolClient,
  target: string,
  f: ResolvedLoad['files'][number]
): Promise<number> {
  const fc = JSON.parse(readFileSync(f.path, 'utf8')) as {
    features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
  };
  const base = 'ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)';
  const geom = f.multiLine || f.multiPolygon ? `ST_Multi(${base})` : base;
  for (const [index, feature] of fc.features.entries()) {
    const cols = f.columns(feature.properties, index);
    const names = Object.keys(cols);
    // Interpolated below: a column map must return plain column names, never keys taken from data.
    for (const name of names) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`load-geojson: "${name}" is not a column name (${target})`);
    }
    await client.query(
      `INSERT INTO ${target} (${names.join(', ')}, geom)
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, ${geom.replace('$GEOM', `$${names.length + 1}`)})`,
      [...Object.values(cols), JSON.stringify(feature.geometry)]
    );
  }
  return fc.features.length;
}

/**
 * Non-versioned: the target tables are a closed set, so they are replaced, not upserted — a unit
 * dropped from the source must disappear. Deleted in reverse file order (wards reference provinces
 * with ON DELETE RESTRICT), loaded in file order.
 */
async function loadReplacing(client: PoolClient, load: ResolvedLoad): Promise<LoadOutcome> {
  for (const f of [...load.files].reverse()) await client.query(`DELETE FROM ${f.target}`);
  const parts: string[] = [];
  for (const f of load.files) parts.push(`${f.target} ${await insertPlain(client, f.target!, f)}`);
  // admin.working_region is the union of region provinces, stored; it must follow its source
  // in the same transaction. Absent on a database migrated before migration 24.
  if (load.files.some((f) => f.target === 'admin.provinces')) {
    const { rows: [r] } = await client.query<{ present: boolean }>(
      `SELECT to_regclass('admin.working_region') IS NOT NULL AS present`);
    if (r.present) await client.query(`REFRESH MATERIALIZED VIEW admin.working_region`);
  }
  // Every layer's stamping joins against these next; see the note on ANALYZE in loadVersioned.
  for (const f of load.files) await client.query(`ANALYZE ${f.target}`);
  return { action: 'replaced', summary: `${load.layer}: replaced ${parts.join(', ')}` };
}

/**
 * The load itself, on the caller's client and inside the caller's transaction: every read is on
 * that client, so a caller (the stage below, or a test that rolls back) sees one consistent state.
 */
export async function applyLoadGeojson(
  pool: Pool,
  client: PoolClient,
  load: ResolvedLoad,
  opts: { supersedeEdits: boolean }
): Promise<LoadOutcome> {
  return load.versioned ? loadVersioned(pool, client, load, opts) : loadReplacing(client, load);
}

/** The stage: one transaction on one client around the load (spec §11). */
export async function executeLoadGeojson(pool: Pool, stage: LoadStage, ctx: StageContext): Promise<StageResult> {
  const load = resolveLoad(stage);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyLoadGeojson(pool, client, load, { supersedeEdits: ctx.supersedeEdits });
    await client.query('COMMIT');
    ctx.log(outcome.summary);
    return { summary: outcome.summary };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

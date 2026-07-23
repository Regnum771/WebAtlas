import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsRepository } from './repository';

afterAll(async () => {
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key LIKE 'zz_%'`);
  await closePool();
});

async function insertVersion(fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await getPool().query(
    `INSERT INTO app.dataset_versions (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    vals
  );
  return rows[0].id;
}

describe('app.dataset_versions constraints', () => {
  it('accepts an ingest version with a null parent', async () => {
    const id = await insertVersion({
      layer_key: 'zz_ok', kind: 'ingest', source: 'seed', label: 'version 1', is_active: false,
    });
    expect(id).toBeTruthy();
  });

  it('rejects an ingest version that has a parent', async () => {
    const parent = await insertVersion({
      layer_key: 'zz_bad_ingest', kind: 'ingest', source: 'seed', label: 'v1', is_active: false,
    });
    await expect(insertVersion({
      layer_key: 'zz_bad_ingest', kind: 'ingest', source: 'seed', label: 'v2',
      parent_version_id: parent, is_active: false,
    })).rejects.toThrow(/dataset_versions_kind_parent|check constraint/i);
  });

  it('rejects an edit version with a null parent', async () => {
    await expect(insertVersion({
      layer_key: 'zz_bad_edit', kind: 'edit', source: 'edit session', label: 'edits', is_active: false,
    })).rejects.toThrow(/dataset_versions_kind_parent|check constraint/i);
  });

  it('refuses two active versions of the same layer', async () => {
    await insertVersion({
      layer_key: 'zz_active', kind: 'ingest', source: 'seed', label: 'v1', is_active: true,
    });
    await expect(insertVersion({
      layer_key: 'zz_active', kind: 'ingest', source: 'seed', label: 'v2', is_active: true,
    })).rejects.toThrow(/dataset_versions_active_per_layer|unique/i);
  });
});

const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

describe('backfill: existing data is version 1', () => {
  it('each thematic layer has exactly one active ingest version', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS n FROM app.dataset_versions
         WHERE layer_key = $1 AND kind = 'ingest' AND is_active`,
        [layer]
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it('every feature row carries a dataset_version_id', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS bad FROM water.${layer} WHERE dataset_version_id IS NULL`
      );
      expect(rows[0].bad).toBe(0);
    }
  });

  it('has a composite (dataset_version_id, external_id) unique index and no global external_id unique', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='water' AND tablename=$1`,
        [layer]
      );
      const defs = rows.map((r) => r.indexdef);
      const hasComposite = defs.some(
        (d) => /unique/i.test(d) && /dataset_version_id/i.test(d) && /external_id/i.test(d)
      );
      const hasGlobal = defs.some(
        (d) => /unique/i.test(d) && /\(external_id\)/i.test(d) && !/dataset_version_id/i.test(d)
      );
      expect(hasComposite, `${layer} composite unique`).toBe(true);
      expect(hasGlobal, `${layer} global unique removed`).toBe(false);
    }
  });

  it('has a deleted column defaulting to false', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS n FROM water.${layer} WHERE deleted = false`
      );
      const { rows: total } = await getPool().query(`SELECT count(*)::int AS n FROM water.${layer}`);
      expect(rows[0].n).toBe(total[0].n);
    }
  });
});

describe('versionsRepository resolver (§4)', () => {
  const pg = () => getPool();
  const madeVersions: string[] = [];

  afterAll(async () => {
    // dataset_versions cascade to child edit versions; feature rows FK to them, so
    // delete feature rows first for our synthetic layer, then versions.
    await pg().query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1)`, [madeVersions]);
    await pg().query(`DELETE FROM app.dataset_versions WHERE id = ANY($1)`, [madeVersions]);
  });

  async function newIngest(): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ('dams', 'ingest', 'test', 'ingest', false) RETURNING id`
    );
    madeVersions.push(rows[0].id);
    return rows[0].id;
  }
  async function newEdit(parent: string): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       VALUES ('dams', 'edit', $1, 'edit session', 'edits', false) RETURNING id`,
      [parent]
    );
    madeVersions.push(rows[0].id);
    return rows[0].id;
  }
  // Insert a dam row into a version. Returns its uuid pk.
  async function addFeature(versionId: string, externalId: number, opts: { deleted?: boolean; name?: string } = {}): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO water.dams (external_id, name, dataset_version_id, deleted, geom)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(105.8, 21.0), 4326)) RETURNING id`,
      [externalId, opts.name ?? `f${externalId}`, versionId, opts.deleted ?? false]
    );
    return rows[0].id;
  }

  it('resolves an ingest version as a flat set', async () => {
    const v = await newIngest();
    const a = await addFeature(v, 1001);
    const b = await addFeature(v, 1002);
    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', v);
    expect(new Set(ids)).toEqual(new Set([a, b]));
  });

  it('resolves an edit version: parent overlaid by session changes, tombstones absent', async () => {
    const ingest = await newIngest();
    const keep = await addFeature(ingest, 2001, { name: 'orig-keep' });
    await addFeature(ingest, 2002, { name: 'orig-changed' });
    await addFeature(ingest, 2003, { name: 'orig-deleted' });

    const edit = await newEdit(ingest);
    const changed = await addFeature(edit, 2002, { name: 'edited' });      // update overlays parent
    await addFeature(edit, 2003, { deleted: true });                        // tombstone removes parent feature
    const added = await addFeature(edit, 2004, { name: 'new-in-edit' });   // brand-new feature

    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', edit);
    // keep (inherited), changed (nearest wins), added (new). 2003 tombstoned => absent.
    expect(new Set(ids)).toEqual(new Set([keep, changed, added]));
  });

  it('resolves a two-deep edit chain nearest-wins', async () => {
    const ingest = await newIngest();
    await addFeature(ingest, 3001, { name: 'v0' });
    const edit1 = await newEdit(ingest);
    await addFeature(edit1, 3001, { name: 'v1' });
    const edit2 = await newEdit(edit1);
    const v2row = await addFeature(edit2, 3001, { name: 'v2' });

    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', edit2);
    expect(ids).toEqual([v2row]); // the edit2 row wins over edit1 and ingest
  });
});

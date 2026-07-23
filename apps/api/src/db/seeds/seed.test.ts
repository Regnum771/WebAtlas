import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';
import { runSeeds } from './run';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';

beforeAll(async () => {
  await runSeeds();
});
afterAll(async () => {
  await closePool();
});

// What the map shows: rows belonging to the layer's *active* version. Seeding now
// appends a new version rather than overwriting, so the raw table holds one row-set
// per version and a bare count(*) would grow with every run.
async function count(table: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM water.${table} f
     JOIN app.dataset_versions v ON v.id = f.dataset_version_id
     WHERE v.layer_key = $1 AND v.is_active AND NOT f.deleted`,
    [table]
  );
  return rows[0].n;
}

describe('seeds', () => {
  it('loads dams and rivers from the source GeoJSON', async () => {
    expect(await count('dams')).toBe(371);
    expect(await count('rivers')).toBe(2013);
  });

  it('loads the five mock layers (2 features each)', async () => {
    for (const t of ['stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(await count(t)).toBe(2);
    }
  });

  it('stores only valid 4326 geometry (ignoring rows with no geometry)', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS bad FROM water.dams f
       JOIN app.dataset_versions v ON v.id = f.dataset_version_id
       WHERE v.layer_key = 'dams' AND v.is_active
         AND f.geom IS NOT NULL AND (NOT ST_IsValid(f.geom) OR ST_SRID(f.geom) <> 4326)`
    );
    expect(rows[0].bad).toBe(0);
  });

  it('stores NULL geometry for the 19 dams with no source coordinates', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.dams f
       JOIN app.dataset_versions v ON v.id = f.dataset_version_id
       WHERE v.layer_key = 'dams' AND v.is_active AND f.geom IS NULL`
    );
    expect(rows[0].n).toBe(19);
  });

  it('re-running appends a version rather than mutating the active one in place', async () => {
    const activeBefore = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active`
    );
    await runSeeds();
    const activeAfter = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active`
    );
    expect(activeAfter.rows[0].id).not.toBe(activeBefore.rows[0].id);
    // The new active version still holds exactly the 2 source features.
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.flood_zones WHERE dataset_version_id = $1 AND NOT deleted`,
      [activeAfter.rows[0].id]
    );
    expect(rows[0].n).toBe(2);
  });

  it('assigns every dam a valid status slug (not null)', async () => {
    const { rows } = await getPool().query(
      `SELECT DISTINCT f.status FROM water.dams f
       JOIN app.dataset_versions v ON v.id = f.dataset_version_id
       WHERE v.layer_key = 'dams' AND v.is_active`
    );
    const statuses = rows.map((r) => r.status);
    // no nulls
    expect(statuses.includes(null)).toBe(false);
    // every distinct value is a known slug
    for (const s of statuses) {
      expect(DAM_STATUS_SLUGS).toContain(s);
    }
    // variety: more than one distinct status present across 371 dams
    expect(statuses.length).toBeGreaterThan(1);
  });
});

describe('seeds create dataset versions (§6)', () => {
  it('each seeded layer has an active ingest version whose feature_count matches its rows', async () => {
    for (const layer of ['dams', 'rivers', 'stations']) {
      const { rows } = await getPool().query(
        `SELECT id, feature_count FROM app.dataset_versions
         WHERE layer_key = $1 AND kind = 'ingest' AND is_active`,
        [layer]
      );
      expect(rows).toHaveLength(1);
      // Scope to that version: the table holds one row-set per version, so an
      // unscoped count would include every prior ingest too.
      const { rows: live } = await getPool().query(
        `SELECT count(*)::int AS n FROM water.${layer}
         WHERE dataset_version_id = $1 AND NOT deleted`,
        [rows[0].id]
      );
      expect(rows[0].feature_count).toBe(live[0].n);
    }
  });

  it('records provenance from the seed registry on the version row', async () => {
    const { rows } = await getPool().query(
      `SELECT source, label, kind, parent_version_id FROM app.dataset_versions
       WHERE layer_key = 'dams' AND is_active`
    );
    expect(rows[0].source).toBe('thuydienvietnam.geojson');
    expect(rows[0].label).toBe('version 1');
    expect(rows[0].kind).toBe('ingest');
    expect(rows[0].parent_version_id).toBeNull();
  });

  it('a second seed run creates a new active version and leaves the prior one addressable', async () => {
    const before = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
    );
    const priorActive = before.rows[0].id;

    await runSeeds();

    const versions = await getPool().query(
      `SELECT count(*)::int AS n FROM app.dataset_versions WHERE layer_key = 'stations'`
    );
    expect(versions.rows[0].n).toBeGreaterThanOrEqual(2);

    const active = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
    );
    expect(active.rows[0].id).not.toBe(priorActive); // active moved to the new version

    // The prior version is still there and its rows still resolvable.
    const prior = await getPool().query(
      `SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1`,
      [priorActive]
    );
    expect(prior.rows[0].n).toBe(2);
  });
});

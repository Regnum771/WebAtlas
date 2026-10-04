import { describe, it, expect, afterAll } from 'vitest';
import { ensureSeeded } from '@webatlas/atlas-data';
import { getPool, closePool } from './pool';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';

// The global setup (src/test/globalSetup.ts) has already brought every layer to the committed
// seed content; these tests assert what that content is.
afterAll(async () => {
  await closePool();
});

// What the map shows: rows belonging to the layer's *active* version. The raw table holds one
// row-set per version, so a bare count(*) would count every load the layer has ever had.
async function count(table: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM water.${table} f
     JOIN app.dataset_versions v ON v.id = f.dataset_version_id
     WHERE v.layer_key = $1 AND v.is_active AND NOT f.deleted`,
    [table]
  );
  return rows[0].n;
}

describe('the seeded layers', () => {
  it('loads dams from the source GeoJSON', async () => {
    // 151 = số đập còn lại sau khi clip-to-region.mjs cắt danh mục 371 đập toàn quốc
    // xuống vùng công tác 6 tỉnh (132 có toạ độ trong vùng + 19 bản ghi thiếu toạ độ
    // được giữ lại vì vẫn là dòng danh mục hợp lệ).
    expect(await count('dams')).toBe(151);
  });

  it('rivers never comes from thuyhe.geojson (nationwide legacy rivers): OSM is the sole source', async () => {
    const { rows: active } = await getPool().query(
      `SELECT source FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
    );
    expect(active).toHaveLength(1);
    expect(active[0].source).not.toBe('thuyhe.geojson');
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

  it('seeding again creates no version and leaves the active one in place', async () => {
    // The old seed command appended a version of every layer on every run. The loader is keyed
    // to file content, so an unchanged file changes nothing.
    const state = async () =>
      (
        await getPool().query(
          `SELECT (SELECT count(*)::int FROM app.dataset_versions) AS n,
                  (SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active) AS active`
        )
      ).rows[0];
    const before = await state();
    const out = await ensureSeeded(getPool());
    expect(out.every((o) => o.action === 'unchanged'), JSON.stringify(out)).toBe(true);
    expect(await state()).toEqual(before);
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.flood_zones WHERE dataset_version_id = $1 AND NOT deleted`,
      [before.active]
    );
    expect(rows[0].n).toBe(2);
  }, 120_000);

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
    // variety: more than one distinct status present across the seeded dams
    expect(statuses.length).toBeGreaterThan(1);
  });

  it('seeds lakes as an active version from OSM water bodies', async () => {
    const { rows: feat } = await getPool().query('SELECT count(*)::int AS n FROM water.lakes_active');
    expect(feat[0].n).toBeGreaterThan(0);

    const { rows: ver } = await getPool().query(`
      SELECT source, label, is_active FROM app.dataset_versions
      WHERE layer_key = 'lakes' AND is_active
    `);
    // The source is the file and a hash of its content; the label is still "version N".
    expect(ver[0].is_active).toBe(true);
    expect(ver[0].source).toMatch(/^osm-lakes-region\.geojson@sha256:[0-9a-f]{64}$/);
    expect(ver[0].label).toMatch(/^version \d+$/);

    // Attribute mapping landed: at least one lake has a mapped type. OSM không có
    // Lake_area/Vol_total/Shore_len như HydroLAKES nên area_km2 luôn NULL ở nguồn này.
    const { rows: sample } = await getPool().query(`
      SELECT lake_type, area_km2 FROM water.lakes_active WHERE lake_type IS NOT NULL LIMIT 1
    `);
    expect(sample[0].lake_type).not.toBeNull();
  });
});

describe('seeds create dataset versions (§6)', () => {
  it('each seeded layer has an active ingest version whose feature_count matches its rows', async () => {
    // rivers is excluded: its feature_count includes the level-1 rivers activation derives,
    // and it has its own tests.
    for (const layer of ['dams', 'stations']) {
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

  it('records the content it was loaded from on the version row', async () => {
    const { rows } = await getPool().query(
      `SELECT source, label, kind, parent_version_id FROM app.dataset_versions
       WHERE layer_key = 'dams' AND is_active`
    );
    expect(rows[0].source).toMatch(/^dams\.geojson@sha256:[0-9a-f]{64}$/);
    expect(rows[0].label).toMatch(/^version \d+$/);
    expect(rows[0].kind).toBe('ingest');
    expect(rows[0].parent_version_id).toBeNull();
  });

});

describe('administrative stamping of the seeded layers', () => {
  it('stamps dams with the province they fall in', async () => {
    const { rows } = await getPool().query<{ stamped: string; total: string }>(
      `SELECT count(*) FILTER (WHERE array_length(province_codes, 1) IS NOT NULL)::text AS stamped,
              count(*)::text AS total
         FROM water.dams_active WHERE geom IS NOT NULL`
    );
    // Every dam in the working region sits inside a province; a handful outside the six
    // provinces legitimately stamp empty, so this asserts the bulk rather than all.
    expect(Number(rows[0].stamped)).toBeGreaterThan(Number(rows[0].total) * 0.9);
  });
});

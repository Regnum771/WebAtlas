import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Roi } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { NotFoundError, ValidationError } from '../../errors';
import { resolveRoi } from './resolve';

let damId: string;
let damName: string | null;
let lakeId: string;
let namedWay: { id: string; name: string };
let orphanWay: { id: string; name: string };
let roadEntityId: string;

beforeAll(async () => {
  const pool = getPool();
  ({ rows: [{ id: damId, name: damName }] } = await pool.query(
    `SELECT id::text, name FROM water.dams_active WHERE province_codes && ARRAY['66'] ORDER BY name LIMIT 1`
  ));
  ({ rows: [{ id: lakeId }] } = await pool.query(
    `SELECT id::text FROM water.lakes_active WHERE province_codes && ARRAY['66'] ORDER BY area_km2 DESC NULLS LAST LIMIT 1`
  ));
  // A way of Sông Thu Bồn: its level-1 river is what `whole` must return.
  ({ rows: [namedWay] } = await pool.query(
    `SELECT id::text, name FROM water.rivers_active
      WHERE feature_level = 3 AND name = 'Sông Thu Bồn' AND parent_external_id IS NOT NULL
      ORDER BY external_id LIMIT 1`
  ));
  // A named way whose name matched no reach (Phase 3, Deviation 3): it has no river.
  ({ rows: [orphanWay] } = await pool.query(
    `SELECT id::text, name FROM water.rivers_active
      WHERE feature_level = 3 AND name IS NOT NULL AND parent_external_id IS NULL
      ORDER BY external_id LIMIT 1`
  ));
  ({ rows: [{ entity_id: roadEntityId }] } = await pool.query(
    `SELECT entity_id FROM basemap.reference_entities
      WHERE layer_key = 'roads' AND member_count BETWEEN 2 AND 20
      ORDER BY member_count ASC, entity_id LIMIT 1`
  ));
});
afterAll(async () => { await closePool(); });

const resolve = (roi: Roi) => resolveRoi(getPool(), roi);
const square = (lon: number, lat: number, d: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
});

describe('resolveRoi — drawn', () => {
  it('resolves a polygon to an area with its km², label and centroid', async () => {
    const r = await resolve({ source: 'drawn', geometry: square(108.05, 12.68, 0.02) });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Hình vẽ');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(18);
    expect(areaKm2).toBeLessThan(20);
    expect(r.resolved.centroid[0]).toBeCloseTo(108.05, 2);
    expect(r.resolved.centroid[1]).toBeCloseTo(12.68, 2);
    expect(r.resolved.bbox[0]).toBeLessThan(r.resolved.bbox[2]);
  });

  it('turns a point plus a radius into an area of about π r²', async () => {
    const r = await resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, radiusKm: 1 });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Hình vẽ + 1 km');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(3.0);
    expect(areaKm2).toBeLessThan(3.2);
  });

  it('measures a line in km', async () => {
    const r = await resolve({ source: 'drawn', geometry: { type: 'LineString', coordinates: [[108.05, 12.68], [108.25, 12.681]] } });
    expect(r.resolved.kind).toBe('line');
    const { lengthKm } = r.resolved.measure as { lengthKm: number };
    expect(lengthKm).toBeGreaterThan(21);
    expect(lengthKm).toBeLessThan(22.5);
  });

  it('refuses a drawing entirely outside the working region', async () => {
    // Hà Nội: inside Vietnam, outside the six provinces.
    await expect(resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [105.85, 21.03] } }))
      .rejects.toThrow(/ngoài vùng công tác/);
  });

  it('refuses a result over the area limit, quoting both figures', async () => {
    // 100 km around this point in Gia Lai clips to ~30,257 km² (measured 2026-09-30).
    const run = resolve({ source: 'drawn', geometry: { type: 'Point', coordinates: [108.4, 13.6] }, radiusKm: 100 });
    await expect(run).rejects.toBeInstanceOf(ValidationError);
    await expect(run).rejects.toThrow(/diện tích[\s\S]*25\.000 km²/);
  });
});

describe('resolveRoi — feature', () => {
  it('resolves a dam to a point with no measure', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'dams', featureId: damId });
    expect(r.resolved.kind).toBe('point');
    expect(r.resolved.measure).toBeNull();
    expect(r.resolved.label).toBe(damName ?? 'Đối tượng không tên');
    expect(r.facts.feature).toEqual({ layerKey: 'dams', featureId: damId });
  });

  it('refuses a radius on something that is already an area', async () => {
    await expect(resolve({ source: 'feature', layerKey: 'lakes', featureId: lakeId, radiusKm: 1 }))
      .rejects.toThrow(/không cần bán kính/);
  });

  it('with whole: true, resolves a river way to its whole level-1 river', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'rivers', featureId: namedWay.id, whole: true });
    expect(r.resolved.label).toBe('Sông Thu Bồn');
    expect(r.resolved.kind).toBe('line');
    const { rows: [river] } = await getPool().query<{ feature_level: number }>(
      `SELECT feature_level FROM water.rivers WHERE id = $1`, [r.facts.feature!.featureId]
    );
    expect(river.feature_level).toBe(1);
  });

  it('with whole: true on a way that has no river, resolves the way itself as "(đoạn)"', async () => {
    const r = await resolve({ source: 'feature', layerKey: 'rivers', featureId: orphanWay.id, whole: true });
    expect(r.resolved.label).toBe(`${orphanWay.name} (đoạn)`);
    expect(r.facts.feature!.featureId).toBe(orphanWay.id);
  });

  it('404s a feature that does not exist', async () => {
    await expect(resolve({ source: 'feature', layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resolveRoi — reference', () => {
  it('resolves a road to a line, and to an area with a radius', async () => {
    const line = await resolve({ source: 'reference', referenceLayer: 'roads', entityId: roadEntityId });
    expect(line.resolved.kind).toBe('line');
    const area = await resolve({ source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 });
    expect(area.resolved.kind).toBe('area');
    expect(area.resolved.label).toMatch(/ \+ 1 km$/);
  });
});

describe('resolveRoi — admin', () => {
  it('resolves a province to its area, label and facts', async () => {
    const r = await resolve({ source: 'admin', level: 'province', code: '66' });
    expect(r.resolved.kind).toBe('area');
    expect(r.resolved.label).toBe('Tỉnh Đắk Lắk');
    const { areaKm2 } = r.resolved.measure as { areaKm2: number };
    expect(areaKm2).toBeGreaterThan(18_000);
    expect(areaKm2).toBeLessThan(18_200);
    expect(r.facts.admin).toEqual({ level: 'province', code: '66' });
  });

  it('resolves Khánh Hoà, whose 5,195 vertices are over the resulting-vertex cap', async () => {
    const r = await resolve({ source: 'admin', level: 'province', code: '56' });
    expect(r.resolved.kind).toBe('area');
  });

  it('resolves a ward', async () => {
    const r = await resolve({ source: 'admin', level: 'ward', code: '22015' });
    expect(r.resolved.label).toBe('Phường Tuy Hoà');
  });

  it('refuses a province outside the working region, and 404s one that does not exist', async () => {
    await expect(resolve({ source: 'admin', level: 'province', code: '01' })).rejects.toThrow(/ngoài vùng công tác/);
    await expect(resolve({ source: 'admin', level: 'ward', code: '999999' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

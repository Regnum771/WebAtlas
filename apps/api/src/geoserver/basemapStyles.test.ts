import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { getPool, closePool } from '../db/pool';

/**
 * Tests over the SLD ARTIFACTS, not over a live GeoServer.
 *
 * `scripts/basemap/styles.py` writes each `<name>.sld` to disk as a side effect
 * of uploading it, and those files are committed — so asserting against them is
 * asserting against what the generator produces, without needing Python or a
 * running GeoServer in the test run.
 */
const SLD_DIR = join(process.cwd(), 'scripts', 'basemap');
const read = (name: string) => readFileSync(join(SLD_DIR, `${name}.sld`), 'utf8');

/** The app clamps zoom at 1:100.000 (MAX_SCALE in the frontend's zoomScale.ts). */
const MAX_SCALE = 100_000;

/**
 * Classes we have decided NOT to draw. Listing them here is the point: an
 * unmapped class must be a recorded decision, not an accident. 'unknown' is
 * OSM's own placeholder for a way with no usable highway tag.
 */
const DELIBERATELY_UNDRAWN = new Set(['unknown']);

const STYLED_TABLES: Array<{ table: string; sld: string }> = [
  { table: 'roads_vn', sld: 'basemap_roads_vn' },
  { table: 'roads_region', sld: 'basemap_roads_region' },
  { table: 'railways_vn', sld: 'basemap_railways' },
  { table: 'water_region', sld: 'basemap_water' },
];

let pool: Pool;
beforeAll(() => {
  pool = getPool();
});
afterAll(async () => {
  await closePool();
});

function scaleGates(sld: string): number[] {
  return [...sld.matchAll(/<MaxScaleDenominator>(\d+)<\/MaxScaleDenominator>/g)].map((m) => Number(m[1]));
}

function fclassesNamed(sld: string): Set<string> {
  return new Set(
    [...sld.matchAll(/<ogc:Literal>([^<]+)<\/ogc:Literal>/g)].map((m) => m[1]),
  );
}

describe('basemap SLD artifacts', () => {
  it('keeps every rule reachable — a gate at or below MAX_SCALE never fires', () => {
    // The bug this guards: scale(max_=35000) reads as "draw below 1:35.000", but
    // the app never zooms past 1:100.000, so the rule is dead and its classes are
    // invisible at every reachable zoom. Silent, and invisible in any screenshot
    // because the roads simply are not there to miss.
    for (const { sld } of STYLED_TABLES) {
      for (const gate of scaleGates(read(sld))) {
        expect(gate, `${sld} has an unreachable gate at 1:${gate}`).toBeGreaterThan(MAX_SCALE);
      }
    }
  });

  it('draws the major road tiers at every reachable scale', () => {
    // motorway/trunk/primary carry the map when zoomed out; an upper gate on them
    // would blank the national network at exactly the scales it matters most.
    expect(scaleGates(read('basemap_roads_vn'))).toHaveLength(0);
  });

  it('tiers the region roads by the agreed thresholds', () => {
    const gates = new Set(scaleGates(read('basemap_roads_region')));
    expect(gates).toEqual(new Set([1_000_000, 500_000, 250_000]));
  });

  it('names every fclass present in the data, so no class is silently dropped', async () => {
    // The spec's rule: a value not named in any rule is not drawn. A later OSM
    // import adding a class would otherwise vanish with no error anywhere — this
    // is the "fail loudly" the design asks for, enforced against the live tables.
    //
    // Coverage is per LAYER GROUP, not per table: roads_region physically holds
    // the major classes too, but roads_vn is what draws them, and naming them in
    // both would double-draw the national network.
    const roadsNamed = new Set([
      ...fclassesNamed(read('basemap_roads_vn')),
      ...fclassesNamed(read('basemap_roads_region')),
    ]);
    const groups: Array<{ table: string; named: Set<string> }> = [
      { table: 'roads_vn', named: roadsNamed },
      { table: 'roads_region', named: roadsNamed },
      { table: 'railways_vn', named: fclassesNamed(read('basemap_railways')) },
      { table: 'water_region', named: fclassesNamed(read('basemap_water')) },
    ];

    for (const { table, named } of groups) {
      const { rows } = await pool.query<{ fclass: string }>(
        `SELECT DISTINCT fclass FROM basemap.${table} WHERE fclass IS NOT NULL`,
      );
      const missing = rows
        .map((r) => r.fclass)
        .filter((f) => !named.has(f) && !DELIBERATELY_UNDRAWN.has(f));
      expect(missing, `${table} has classes no rule names: ${missing.join(', ')}`).toEqual([]);
    }
  });
});

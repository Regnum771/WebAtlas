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

/** The app clamps zoom at 1:25.000 (MAX_SCALE in the frontend's zoomScale.ts). */
const MAX_SCALE = 25_000;

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

  it('keeps motorway at every scale but tiers the rest of the national network', () => {
    // The range now reaches 1:12.800.000, where drawing all 62.598 national road
    // segments is a hairball. motorway alone (9.946) is the readable overview;
    // trunk and primary join as you come in.
    const gates = new Set(scaleGates(read('basemap_roads_vn')));
    expect(gates).toEqual(new Set([5_000_000, 3_000_000, 1_000_000]));
  });

  it('tiers the region roads by the agreed thresholds', () => {
    const gates = new Set(scaleGates(read('basemap_roads_region')));
    expect(gates).toEqual(new Set([1_000_000, 500_000, 250_000, 100_000, 50_000]));
  });

  it('uses the widened close end — tracks and paths appear below 1:100.000', () => {
    // Before the range reached 1:25.000 there was nothing left to reveal below
    // 1:200.000, so the last two notches showed the same map, only bigger.
    const sld = read('basemap_roads_region');
    const trackRule = sld.slice(sld.indexOf('<Name>track_path</Name>'));
    expect(trackRule).toContain('<MaxScaleDenominator>100000</MaxScaleDenominator>');
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

  it('labels roads, tiered so names do not swamp the map', () => {
    // The basemap drew every road as an unnamed line: 32.864 named roads in
    // roads_region and 45.542 in roads_vn, none of them rendered.
    const vn = read('basemap_roads_vn');
    const region = read('basemap_roads_region');
    expect(vn).toContain('<TextSymbolizer>');
    expect(region).toContain('<TextSymbolizer>');
    // Line placement, not point placement — a road label has to run along the way.
    expect(vn).toContain('<LinePlacement>');
    expect(vn).toContain('name="followLine"');
    // Segments of one road share a name; grouping them avoids repeating the
    // label on every OSM segment, which is both ugly and expensive to render.
    expect(vn).toContain('name="group"');
  });

  it('labels by name, the field that is actually populated', () => {
    // ref (QL1A) is only on the majors; name covers 99,5% of motorway, 94% of
    // trunk and 91% of primary, so name is the one field worth labelling.
    expect(read('basemap_roads_vn')).toContain('<ogc:PropertyName>name</ogc:PropertyName>');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Tests over the SLD ARTIFACTS, not over a live GeoServer.
 *
 * `tools/basemap/styles.py` writes each `<name>.sld` to disk as a side effect
 * of uploading it, and those files are committed — so asserting against them is
 * asserting against what the generator produces, without needing Python or a
 * running GeoServer in the test run.
 */
const SLD_DIR = dirname(fileURLToPath(import.meta.url));
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

function scaleGates(sld: string): number[] {
  return [...sld.matchAll(/<MaxScaleDenominator>(\d+)<\/MaxScaleDenominator>/g)].map((m) => Number(m[1]));
}

/**
 * The farthest scale a road class draws at: the largest MaxScaleDenominator over the rules named
 * `<key>_casing_z..` / `<key>_fill_z..` / `<key>_z..`, or Infinity if one has none (every scale).
 */
function appearsFrom(sld: string, key: string): number {
  const rules = [...sld.matchAll(new RegExp(`<Rule><Name>${key}_(?:casing_|fill_)?z\\d+</Name>(.*?)</Rule>`, 'g'))];
  expect(rules.length, `no rules for ${key}`).toBeGreaterThan(0);
  return Math.max(...rules.map((m) => Number(/<MaxScaleDenominator>(\d+)</.exec(m[1])?.[1] ?? Infinity)));
}

/** The FeatureTypeStyle passes of an SLD, in drawing order. */
function passes(sld: string): string[] {
  return [...sld.matchAll(/<FeatureTypeStyle>([\s\S]*?)<\/FeatureTypeStyle>/g)].map((m) => m[1]);
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
    const vn = read('basemap_roads_vn');
    expect(appearsFrom(vn, 'motorway')).toBe(Infinity);
    expect(appearsFrom(vn, 'trunk')).toBe(5_000_000);
    expect(appearsFrom(vn, 'primary')).toBe(3_000_000);
  });

  it('brings the region road classes in at the agreed thresholds', () => {
    const region = read('basemap_roads_region');
    expect(appearsFrom(region, 'secondary')).toBe(1_000_000);
    expect(appearsFrom(region, 'tertiary')).toBe(500_000);
    expect(appearsFrom(region, 'unclassified')).toBe(500_000);
    expect(appearsFrom(region, 'residential')).toBe(250_000);
    // Before the range reached 1:25.000 there was nothing left to reveal below
    // 1:200.000, so the last two notches showed the same map, only bigger.
    for (const key of ['service', 'track', 'path', 'cycleway']) expect(appearsFrom(region, key)).toBe(100_000);
  });

  it('draws every casing before any fill, with the bigger road\'s fill on top', () => {
    // In one pass GeoServer draws way by way: each casing lands on the previous way's fill,
    // leaving a grey blob at every joint and a line across every junction.
    for (const name of ['basemap_roads_vn', 'basemap_roads_region']) {
      const [casings, fills] = passes(read(name));
      expect(casings, name).toContain('_casing_z');
      expect(casings, name).not.toContain('_fill_z');
      expect(fills, name).toContain('_fill_z');
      expect(fills, name).not.toContain('_casing_z');
      // Geofabrik's code grows as the class shrinks (5111 motorway ... 5155 steps).
      expect(fills, name).toContain('<VendorOption name="sortBy">code D</VendorOption>');
    }
  });

  it('colours the road classes as the OpenStreetMap map does', () => {
    const vn = read('basemap_roads_vn');
    const fill = (key: string) => new RegExp(`<Name>${key}_fill_z\\d+</Name>.*?name="stroke">(#[0-9a-f]{6})<`).exec(vn)?.[1];
    expect(fill('motorway')).toBe('#e892a2');
    expect(fill('trunk')).toBe('#f9b29c');
    expect(fill('primary')).toBe('#fcd6a4');
  });

  it('names a font the GeoServer image has', () => {
    // Arial is not installed there: GeoServer fell back to a serif face without a word.
    for (const name of ['basemap_roads_vn', 'basemap_roads_region', 'basemap_places_vn', 'basemap_places_region']) {
      const families = new Set([...read(name).matchAll(/name="font-family">([^<]+)</g)].map((m) => m[1]));
      expect(families, name).toEqual(new Set(['DejaVu Sans']));
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

  it('draws land at every scale: it is the whole of the base layer group', () => {
    const sld = read('basemap_land');
    expect(sld).toContain('<PolygonSymbolizer>');
    expect(scaleGates(sld)).toEqual([]);
  });

  it('generates and assigns every style a layer group names', () => {
    // The fresh-clone gap this guards: publish-basemap.sh named basemap_land, styles.py never made
    // it, and GeoServer accepted the group anyway and drew land unstyled. Two scripts, one list.
    const publish = readFileSync(join(SLD_DIR, 'publish-basemap.sh'), 'utf8');
    const groups = publish.slice(publish.indexOf('LAYER_GROUPS=('), publish.indexOf('\n)\n'));
    const pairs = [...groups.matchAll(/([a-z_]+):(basemap_[a-z_]+)/g)].map((m) => ({ layer: m[1], style: m[2] }));
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    const stylesPy = readFileSync(join(SLD_DIR, 'styles.py'), 'utf8');
    for (const { layer, style } of pairs) {
      expect(() => read(style), `${style}.sld is not generated`).not.toThrow();
      expect(stylesPy, `${layer} is not assigned ${style}`).toContain(`("${layer}", "${style}")`);
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)('basemap SLD artifacts vs live tables', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
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
      { table: 'landuse_region', named: fclassesNamed(read('basemap_landuse')) },
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

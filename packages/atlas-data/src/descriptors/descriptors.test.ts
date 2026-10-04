import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { resolveLicences } from '../lineage';
import { REPO_ROOT, resolveStageFile } from '../paths';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { CONTOUR_INTERVALS_M } from './contours';
import { LAYER_GROUPS } from './basemap';

const byId = (id: string) => ALL_DATASETS.find((d) => d.id === id)!;
const runStages = ALL_DATASETS.flatMap((d) =>
  d.stages.filter((s) => s.type === 'run').map((s) => ({ id: d.id, stage: s as Extract<typeof s, { type: 'run' }> }))
);
const WORKSPACE_DIRS: Record<string, string> = { '@webatlas/api': 'apps/api' };

describe('registered datasets', () => {
  it('validate', () => {
    expect(() => validateRegistry()).not.toThrow();
  });

  it('cover every runbook step (spec FR-2)', () => {
    expect(ALL_DATASETS.map((d) => d.id)).toEqual([
      'demo', 'admin_boundaries', 'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion',
      'flood_generation', 'lakes', 'rivers', 'basemap', 'reference_entities', 'dem', 'contours',
    ]);
  });

  it('declare the ordering rules as dependsOn, not prose (spec FR-8)', () => {
    for (const id of ['dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes', 'rivers']) {
      expect(byId(id).dependsOn, id).toEqual(['admin_boundaries']);
    }
    expect(byId('reference_entities').dependsOn).toEqual(['basemap']);
    expect(byId('contours').dependsOn).toEqual(['dem']);
  });

  it('no thematic dataset is a run stage any more: each is one load-geojson and its publishes', () => {
    for (const id of ['dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes']) {
      expect(byId(id).stages.map((s) => s.type), id).toEqual(['load-geojson', 'publish-geoserver']);
    }
    expect(byId('rivers').stages.map((s) => s.type)).toEqual(['load-geojson', 'publish-geoserver', 'publish-geoserver']);
    expect(byId('admin_boundaries').stages.map((s) => s.type)).toEqual(['load-geojson']);
  });

  it('every load-geojson file exists, and each versioned layer is an editable layer key', () => {
    for (const d of ALL_DATASETS) {
      for (const s of d.stages) {
        if (s.type !== 'load-geojson') continue;
        for (const f of s.files) expect(existsSync(resolveStageFile(f)), `${d.id}: ${f.file}`).toBe(true);
        if (s.versioned) {
          expect(EDITABLE_LAYER_KEYS as readonly string[], d.id).toContain(s.layer);
          // The dataset id is the layer key, so `--supersede-edits <id>` names the layer.
          expect(s.layer).toBe(d.id);
        }
      }
    }
  });

  it('every editable layer is loaded by exactly one dataset', () => {
    const layers = ALL_DATASETS.flatMap((d) => d.stages).flatMap((s) => (s.type === 'load-geojson' && s.versioned ? [s.layer] : []));
    expect([...layers].sort()).toEqual([...EDITABLE_LAYER_KEYS].sort());
  });

  it('each versioned load names the source string the old seed command wrote, so machines can be adopted', () => {
    const legacy = Object.fromEntries(
      ALL_DATASETS.flatMap((d) => d.stages).flatMap((s) => (s.type === 'load-geojson' && s.versioned ? [[s.layer, s.legacySource]] : []))
    );
    expect(legacy).toEqual({
      dams: 'thuydienvietnam.geojson', stations: 'stations.geojson', flood_zones: 'flood_zones.geojson',
      drought_points: 'drought_points.geojson', saltwater_intrusion: 'saltwater_intrusion.geojson',
      flood_generation: 'flood_generation.geojson', lakes: 'OSM water bodies', rivers: 'OSM waterways + HydroRIVERS v10',
    });
  });

  it('the boundaries are a non-versioned load of the two files the map itself uses', () => {
    const [load] = byId('admin_boundaries').stages;
    if (load.type !== 'load-geojson') throw new Error('expected load-geojson');
    expect(load.versioned).toBe(false);
    expect(load.files.map((f) => [f.root, f.file, f.target])).toEqual([
      ['repo', 'apps/web/public/provinces-34.geojson', 'admin.provinces'],
      ['repo', 'apps/web/public/wards-region.geojson', 'admin.wards'],
    ]);
  });

  it('licences follow the table in spec §11', () => {
    const licence = (id: string) => byId(id).lineage.licence;
    expect(licence('dams')).toBe('CC-BY-SA-4.0');
    expect(licence('lakes')).toBe('ODbL-1.0');
    expect(licence('rivers')).toBe('ODbL-1.0');
    for (const id of ['stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(licence(id), id).toBe('LicenseRef-webatlas-synthetic');
      expect(byId(id).lineage.statement, id).toMatch(/minh hoạ tổng hợp/);
    }
    expect(licence('admin_boundaries')).toBe('MIT');
  });

  it('every real dataset declares a probe (adoption and verify need one)', () => {
    for (const d of ALL_DATASETS) if (d.id !== 'demo') expect(d.probe, d.id).toBeTypeOf('function');
  });

  it('every tools script a stage names exists in the repository', () => {
    for (const { id, stage } of runStages.filter((r) => r.stage.in === 'tools')) {
      const [interpreter, script] = stage.argv;
      expect(['python3', 'bash'], `${id}: ${stage.argv.join(' ')}`).toContain(interpreter);
      expect(existsSync(join(REPO_ROOT, script)), `${id}: ${script}`).toBe(true);
    }
  });

  it('every host stage names a real npm script in a real workspace', () => {
    for (const { id, stage } of runStages.filter((r) => r.stage.in === 'host')) {
      const [verb, script, flag, workspace] = stage.argv;
      expect([verb, flag], id).toEqual(['run', '-w']);
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, WORKSPACE_DIRS[workspace], 'package.json'), 'utf8'));
      expect(pkg.scripts[script], `${id}: npm run ${script} -w ${workspace}`).toBeTypeOf('string');
    }
  });

  it('no argv carries a secret (it is written to lineage)', () => {
    for (const { id, stage } of runStages) {
      expect(stage.argv.join(' '), id).not.toMatch(/password|passwd|secret|change_me/i);
    }
  });

  it('the basemap extract is a dated Geofabrik file pinned by sha256, never a -latest alias (spec C-10)', () => {
    const bm = byId('basemap').stages;
    const fetch = bm.find((s) => s.type === 'fetch-http') as Extract<(typeof bm)[number], { type: 'fetch-http' }>;
    expect(fetch.url).toMatch(/^https:\/\/download\.geofabrik\.de\/asia\/vietnam-\d{6}-free\.shp\.zip$/);
    expect(fetch.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fetch.into).toBe(`basemap/${fetch.url.split('/').pop()}`);
  });

  it('the basemap pin is a first-of-month extract: Geofabrik deletes dailies after about a week', () => {
    const bm = byId('basemap').stages;
    const fetch = bm.find((s) => s.type === 'fetch-http') as Extract<(typeof bm)[number], { type: 'fetch-http' }>;
    expect(fetch.url).toMatch(/vietnam-\d{4}01-free\.shp\.zip$/);
  });

  it('the basemap probe checks exactly the layer groups the web app requests and the script publishes', () => {
    // Three places name these groups. A fresh clone once passed verify with one of the five: the
    // other four existed only on the developer's GeoServer, created by hand.
    const sorted = (xs: Iterable<string>) => [...xs].sort();
    const mapModel = readFileSync(join(REPO_ROOT, 'apps/web/src/features/map/model/MapModel.ts'), 'utf8');
    const requested = new Set([...mapModel.matchAll(/'webatlas:((?:basemap|bm_)[a-z_]*)'/g)].map((m) => m[1]));
    const script = readFileSync(join(REPO_ROOT, 'packages/atlas-data/tools/basemap/publish-basemap.sh'), 'utf8');
    const published = [...script.matchAll(/^ {2}"([a-z_]+)\|/gm)].map((m) => m[1]);
    expect(sorted(LAYER_GROUPS)).toEqual(sorted(requested));
    expect(sorted(LAYER_GROUPS)).toEqual(sorted(published));
  });

  it('path arguments agree between stages of one dataset', () => {
    const bm = byId('basemap').stages;
    const fetch = bm.find((s) => s.type === 'fetch-http') as Extract<(typeof bm)[number], { type: 'fetch-http' }>;
    const load = bm.find((s) => s.type === 'run') as Extract<(typeof bm)[number], { type: 'run' }>;
    expect(load.argv[2]).toBe(`packages/atlas-data/data/cache/${fetch.into}`);

    const dm = byId('dem').stages.filter((s) => s.type === 'run') as Extract<(typeof bm)[number], { type: 'run' }>[];
    const out = dm[0].argv[dm[0].argv.indexOf('--out') + 1];
    expect(dm[1].argv[2]).toBe(`${out}/clipped`);
    const prep = readFileSync(join(REPO_ROOT, 'packages/atlas-data/tools/prep_dem.py'), 'utf8');
    expect(prep).toMatch(/\/ "clipped"/);
  });

  it("contours' intervals match packages/shared/src/contours.ts", () => {
    const src = readFileSync(join(REPO_ROOT, 'packages/shared/src/contours.ts'), 'utf8');
    const m = src.match(/CONTOUR_INTERVALS\s*=\s*\[([^\]]*)\]/);
    expect(m, 'CONTOUR_INTERVALS literal').not.toBeNull();
    expect(m![1].split(',').map((s) => Number(s.trim()))).toEqual([...CONTOUR_INTERVALS_M]);
  });

  it('licences propagate: contours are non-commercial through the DEM, reference entities are ODbL', () => {
    expect(resolveLicences(ALL_DATASETS, 'contours')).toContain('CC-BY-NC-SA-4.0');
    expect(resolveLicences(ALL_DATASETS, 'contours')).not.toContain('ODbL-1.0');
    expect(resolveLicences(ALL_DATASETS, 'reference_entities')).toContain('ODbL-1.0');
  });
});

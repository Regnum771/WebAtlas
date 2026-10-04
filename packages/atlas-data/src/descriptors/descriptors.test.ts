import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { resolveLicences } from '../lineage';
import { REPO_ROOT } from '../paths';
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
      'demo', 'seeds', 'rivers', 'basemap', 'reference_entities', 'dem', 'contours',
    ]);
  });

  it('declare the ordering rules as dependsOn, not prose (spec FR-8)', () => {
    expect(byId('rivers').dependsOn).toEqual(['seeds']);
    expect(byId('reference_entities').dependsOn).toEqual(['basemap']);
    expect(byId('contours').dependsOn).toEqual(['dem']);
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

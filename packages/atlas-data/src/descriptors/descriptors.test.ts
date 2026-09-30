import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { resolveLicences } from '../lineage';
import { REPO_ROOT } from '../paths';
import { CONTOUR_INTERVALS_M } from './contours';

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

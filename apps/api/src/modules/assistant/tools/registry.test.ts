import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MapContext } from '@webatlas/shared';
import { buildTools, guardToolErrors } from './registry';
import { config } from '../../../config/env';
import type { ToolContext } from './types';

const ctx: ToolContext = {
  pool: {} as ToolContext['pool'],
  mapContext: {
    bbox: [107.5, 12.0, 109.0, 13.5],
    zoom: 9,
    visibleLayerStateIds: [],
    basemap: 'street',
  } satisfies MapContext,
  collect: vi.fn(),
  provenance: vi.fn(),
};

describe('buildTools', () => {
  it('builds every registered tool with unique names', () => {
    const tools = buildTools(ctx);
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names.length).toBeGreaterThanOrEqual(11);
    expect(new Set(names).size).toBe(names.length);
  });

  it('offers the gazetteer lookup, without which place names are answered from memory', () => {
    // Not a nice-to-have: with no locate_place in the set, the model fed
    // nearest_features a remembered coordinate and got Buôn Ma Thuột wrong by
    // up to 117 km, three different ways on three runs.
    const names = buildTools(ctx).map((t) => (t as { name: string }).name);
    expect(names).toContain('locate_place');
  });

  it('returns tools in a stable order — the definitions sit in the cached prefix', () => {
    const a = buildTools(ctx).map((t) => (t as { name: string }).name);
    const b = buildTools(ctx).map((t) => (t as { name: string }).name);
    expect(a).toEqual(b);
  });

  // buildTools reads config.ASSISTANT_DATABASE_URL at call time, so both branches
  // are exercised by setting the real value and restoring it — no module mock.
  // Asserting a bare tool count would pass either way, which is what made the
  // conditional untested before.
  describe('the run_sql escape hatch is conditional', () => {
    const original = config.ASSISTANT_DATABASE_URL;
    afterEach(() => {
      config.ASSISTANT_DATABASE_URL = original;
    });

    it('is offered when a read-only role is configured', () => {
      config.ASSISTANT_DATABASE_URL = 'postgres://webatlas_assistant:pw@localhost:5432/webatlas';
      const names = buildTools(ctx).map((t) => (t as { name: string }).name);
      expect(names).toContain('run_sql');
    });

    it('is absent when it is not — an always-unavailable tool would waste cached-prefix tokens every turn', () => {
      config.ASSISTANT_DATABASE_URL = undefined;
      const names = buildTools(ctx).map((t) => (t as { name: string }).name);
      expect(names).not.toContain('run_sql');
    });

    it('leaves the other tools untouched in either branch', () => {
      config.ASSISTANT_DATABASE_URL = undefined;
      const without = buildTools(ctx).map((t) => (t as { name: string }).name);
      config.ASSISTANT_DATABASE_URL = 'postgres://webatlas_assistant:pw@localhost:5432/webatlas';
      const with_ = buildTools(ctx).map((t) => (t as { name: string }).name);
      expect(with_).toEqual([...without, 'run_sql']);
    });
  });
});

describe('guardToolErrors', () => {
  it('turns a thrown tool error into text the model can act on', async () => {
    const tool = guardToolErrors({
      name: 'boom',
      run: () => {
        throw new Error('connection terminated');
      },
    } as never) as { run: (i: unknown) => Promise<string> };
    const result = await tool.run({});
    expect(result).toContain('gặp lỗi');
    expect(result).toContain('connection terminated');
  });

  it('passes a successful result through untouched', async () => {
    const tool = guardToolErrors({ name: 'ok', run: () => 'fine' } as never) as {
      run: (i: unknown) => Promise<string>;
    };
    expect(await tool.run({})).toBe('fine');
  });

  it('catches a rejected promise as well as a synchronous throw', async () => {
    const tool = guardToolErrors({
      name: 'async-boom',
      run: () => Promise.reject(new Error('timeout')),
    } as never) as { run: (i: unknown) => Promise<string> };
    expect(await tool.run({})).toContain('timeout');
  });
});

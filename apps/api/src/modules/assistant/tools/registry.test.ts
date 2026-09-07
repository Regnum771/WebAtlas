import { describe, it, expect, vi } from 'vitest';
import type { MapContext } from '@webatlas/shared';
import { buildTools, guardToolErrors } from './registry';
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

  it('returns tools in a stable order — the definitions sit in the cached prefix', () => {
    const a = buildTools(ctx).map((t) => (t as { name: string }).name);
    const b = buildTools(ctx).map((t) => (t as { name: string }).name);
    expect(a).toEqual(b);
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

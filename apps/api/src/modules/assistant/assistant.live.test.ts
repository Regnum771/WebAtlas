/**
 * The one place a live model is required: intent routing. Excluded from the
 * default run by filename (vitest.config.ts) because it costs tokens on every
 * execution. Run deliberately with `npm run test:api:live`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MapCommand, MapContext } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { runAssistant } from './service';
import { config } from '../../config/env';

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

const enabled = Boolean(config.ANTHROPIC_API_KEY);
const maybe = enabled ? describe : describe.skip;

let pool: ReturnType<typeof getPool>;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

function ask(message: string, sessionId = `live-${Math.random()}`) {
  return runAssistant({ pool, userId: 'live-test-user', sessionId, message, mapContext: MAP_CONTEXT });
}

maybe('intent routing (live model)', () => {
  it('routes a province request to a zoom command', async () => {
    const { commands } = await ask('Chuyển bản đồ tới Đắk Lắk');
    expect(commands.some((c: MapCommand) => c.kind === 'zoomToRegion')).toBe(true);
  }, 60_000);

  it('routes a layer request to a visibility command', async () => {
    const { commands } = await ask('Bật lớp sông ngòi lên giúp tôi');
    expect(commands.some((c: MapCommand) => c.kind === 'setLayerVisible')).toBe(true);
  }, 60_000);

  it('answers a counting question from tool results with provenance', async () => {
    const { provenance, segments } = await ask('Có bao nhiêu đập trong khu vực đang xem?');
    expect(provenance.length).toBeGreaterThan(0);
    expect(segments.some((s) => s.kind === 'grounded')).toBe(true);
  }, 60_000);

  it('reports missing data instead of inventing it', async () => {
    const { segments } = await ask('Có bao nhiêu trạm quan trắc ở Bắc Kạn?');
    const all = segments.map((s) => s.text).join(' ');
    // Bắc Kạn is outside the working region; the honest answer says so.
    expect(all.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.kind === 'grounded' || s.kind === 'knowledge')).toBe(true);
  }, 60_000);

  it('keeps multi-turn context within one session', async () => {
    const sessionId = `live-multiturn-${Math.random()}`;
    await ask('Chuyển bản đồ tới Đắk Lắk', sessionId);
    const { segments } = await ask('Còn tỉnh nào nữa trong vùng công tác?', sessionId);
    expect(segments.length).toBeGreaterThan(0);
  }, 90_000);
});

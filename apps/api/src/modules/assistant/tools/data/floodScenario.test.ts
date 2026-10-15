import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { FloodImpacts, FloodPlanRow, FloodScenarioDetail, MapCommand, Provenance } from '@webatlas/shared';
import type { ToolContext } from '../types';

import {
  evacuationPlanWith, floodImpactsWith, listFloodScenariosWith, runFloodScenarioWith, type FloodRepo,
} from './floodScenario';

const START = '2025-10-27T14:00:00.000Z';
const DETAIL: FloodScenarioDetail = {
  id: 'kttv-2025-10', name: 'Bản tin KTTV 21:00 28/10/2025 — tái hiện lũ 10/2025', kind: 'kttv', rainTotalMm: null,
  startTime: START, hours: 96, bulletinHour: 24, basis: 'Mực nước thực đo KTTV',
  stations: [{ id: 'cau-lau', name: 'Câu Lâu', river: 'Thu Bồn', bd1: 2, bd2: 3, bd3: 4, recordM: 5.62, recordYear: 2025, derived: false }],
  series: { 'cau-lau': { level: Array.from({ length: 97 }, (_, h) => (h === 53 ? 5.62 : 5)), forecast: Array.from({ length: 97 }, (_, h) => (h === 34 ? 5.35 : null)) } },
  floodedKm2: Array.from({ length: 97 }, (_, h) => (h === 53 ? 120 : 50)),
  frameExtent: [0, 0, 1, 1],
};
const EMPTY: FloodImpacts = { hour: 0, time: '21:00 27/10/2025', roads: [], wards: [], totals: { roadsCut: 0, wardsWet: 0, buildingsFlooded: 0, peopleEst: 0 } };
const PLAN: FloodPlanRow[] = [
  { priority: 1, wardCode: '1', wardName: 'Phường Hội An Tây', deadlineHour: 0, deadlineTime: '21:00 27/10/2025', alreadyWet: true, peopleEst: 400,
    shelter: { id: 's1', name: 'Trường A', kind: 'school', lonLat: [108.3, 15.88] }, distanceM: 1200, openRoads: [], arrow: { type: 'LineString', coordinates: [[108.32, 15.87], [108.3, 15.88]] } },
  { priority: 2, wardCode: '2', wardName: 'Xã Đại Lộc', deadlineHour: 9, deadlineTime: '06:00 28/10/2025', alreadyWet: false, peopleEst: 900,
    shelter: { id: 's2', name: null, kind: 'place_of_worship', lonLat: [108.1, 15.86] }, distanceM: 2500, openRoads: ['ĐT609'], arrow: { type: 'LineString', coordinates: [[108.12, 15.87], [108.1, 15.86]] } },
];

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool: {} as Pool,
    mapContext: { bbox: [107.9, 15.6, 108.5, 16.0], zoom: 10, visibleLayerStateIds: [], basemap: 'street' },
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
    role: 'viewer',
  } satisfies ToolContext;
  return { ctx, commands, records };
}

const run = (tool: { run: (input: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

let repo: { [K in keyof FloodRepo]: ReturnType<typeof vi.fn> };
let listFloodScenariosTool: ReturnType<typeof listFloodScenariosWith>;
let runFloodScenarioTool: ReturnType<typeof runFloodScenarioWith>;
let floodImpactsTool: ReturnType<typeof floodImpactsWith>;
let evacuationPlanTool: ReturnType<typeof evacuationPlanWith>;
beforeEach(() => {
  repo = {
    getScenario: vi.fn().mockResolvedValue(DETAIL),
    getImpacts: vi.fn().mockResolvedValue(EMPTY),
    getPlan: vi.fn().mockResolvedValue(PLAN),
    listScenarios: vi.fn().mockResolvedValue([DETAIL]),
  };
  const r = repo as unknown as FloodRepo;
  listFloodScenariosTool = listFloodScenariosWith(r);
  runFloodScenarioTool = runFloodScenarioWith(r);
  floodImpactsTool = floodImpactsWith(r);
  evacuationPlanTool = evacuationPlanWith(r);
});

describe('flood scenario tools', () => {
  it('list_flood_scenarios says there is no data when the schema is empty', async () => {
    repo.listScenarios.mockResolvedValue([]);
    const { ctx } = makeCtx();
    expect(await run(listFloodScenariosTool(ctx), {})).toContain('chưa có dữ liệu kịch bản');
  });

  it('run_flood_scenario opens the dock at the bulletin hour by default and reports the peak', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(runFloodScenarioTool(ctx), { scenarioId: 'kttv-2025-10' });
    expect(commands).toEqual([{ kind: 'showFloodScenario', scenarioId: 'kttv-2025-10', hour: 24, play: false }]);
    expect(text).toContain('5.62');
    expect(text).toContain('02:00 30/10/2025');
    expect(records[0]).toMatchObject({ tool: 'run_flood_scenario', layerKey: null });
    expect(records[0].datasetVersion).toContain('Trung tâm Dự báo KTTV');
  });

  it('flood_impacts clamps an hour beyond the scenario and says so', async () => {
    const { ctx } = makeCtx();
    repo.getImpacts.mockResolvedValue({ ...EMPTY, hour: 96, time: '21:00 31/10/2025' });
    const text = await run(floodImpactsTool(ctx), { scenarioId: 'kttv-2025-10', hour: 500 });
    expect(text.startsWith('Đã giới hạn về giờ 96 (21:00 31/10/2025).')).toBe(true);
  });

  it('flood_impacts says plainly when nothing is wet yet', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(floodImpactsTool(ctx), { scenarioId: 'preset-500', hour: 0 });
    expect(text).toContain('Đến 21:00 27/10/2025 chưa có tuyến đường hay xã nào bị ngập trong kịch bản này.');
    expect(commands).toEqual([{ kind: 'showFloodScenario', scenarioId: 'preset-500', hour: 0, play: false }]);
  });

  it('evacuation_plan draws the plan, moves to the earliest deadline and counts its rows', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(evacuationPlanTool(ctx), { scenarioId: 'kttv-2025-10' });
    expect(commands).toEqual([
      { kind: 'showEvacuationPlan', scenarioId: 'kttv-2025-10' },
      { kind: 'showFloodScenario', scenarioId: 'kttv-2025-10', hour: 0, play: false },
    ]);
    expect(text).toContain('đã ngập — cứu hộ');
    expect(text).toContain('ĐT609');
    expect(text).toContain('cơ sở tôn giáo');
    expect(text).not.toContain('place_of_worship');
    expect(records[0].rowCount).toBe(2);
  });
});

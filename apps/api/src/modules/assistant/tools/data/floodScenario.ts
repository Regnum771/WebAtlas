// See zoomToRegion.ts: 'zod/v4' is required by betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { FLOOD_SCENARIO_IDS, formatScenarioTime, type FloodScenarioDetail, type FloodScenarioId } from '@webatlas/shared';
import type { ToolContext, ToolFactory } from '../types';
import * as scenarios from '../../../scenarios/repository';
import { clampHour } from '../../../scenarios/repository';

/** The repository calls the tools make; injected so tests can supply rows without a database. */
export type FloodRepo = Pick<typeof scenarios, 'listScenarios' | 'getScenario' | 'getImpacts' | 'getPlan'>;

const NO_DATA = 'Hệ thống chưa có dữ liệu kịch bản lũ (chưa có dữ liệu kịch bản).';
const LIST_MAX = 30;

/** Fixed clock anchors of every scenario's hours, so the model need not count days itself. */
const HOUR_ANCHORS =
  'Giờ là số giờ tính từ đầu kịch bản: giờ 0 = 05:00 26/10/2025; giờ 19 = 00:00 27/10; giờ 43 = 00:00 28/10; '
  + 'giờ 64 = 21:00 28/10 (bản tin); giờ 67 = 00:00 29/10; giờ 91 = 00:00 30/10; giờ 97 = 06:00 30/10/2025; '
  + 'giờ 115 = 00:00 31/10; giờ 136 = 21:00 31/10/2025.';

/** OSM classes of gathering points, as a reader would say them. */
const SHELTER_KINDS: Record<string, string> = {
  school: 'trường học', kindergarten: 'trường mầm non', college: 'trường cao đẳng', university: 'trường đại học',
  community_centre: 'nhà văn hoá', town_hall: 'trụ sở UBND', place_of_worship: 'cơ sở tôn giáo',
};

/** What the provenance chip credits: recorded levels for the replay, an estimate for presets. */
function basisOf(id: FloodScenarioId): string {
  return id === 'kttv-2025-10' || id === 'preset-1000'
    ? 'Mực nước thực đo: Trung tâm Dự báo KTTV quốc gia; ngập: mô phỏng nhanh trên FABDEM'
    : 'Ước tính từ lũ 10/2025; ngập: mô phỏng nhanh trên FABDEM';
}

function record(ctx: ToolContext, tool: string, id: FloodScenarioId, rowCount: number) {
  ctx.provenance({ tool, layerKey: null, rowCount, datasetVersion: basisOf(id) });
}

const scenarioIdSchema = z.enum(FLOOD_SCENARIO_IDS).describe(
  'kttv-2025-10 = bản tin KTTV 21:00 28/10/2025, tái hiện lũ 10/2025 (mực nước thực đo); preset-500 / preset-1000 / preset-1300 = mưa 500 / 1.000 / 1.300 mm ước tính từ trận này.'
);

function stationLines(d: FloodScenarioDetail): string[] {
  return d.stations.filter((s) => d.series[s.id]).map((s) => {
    const level = d.series[s.id].level;
    const peak = Math.max(...level);
    const at = level.indexOf(peak);
    const vsBd3 = peak >= s.bd3 ? `trên BĐ3 ${(peak - s.bd3).toFixed(2)} m` : `dưới BĐ3 ${(s.bd3 - peak).toFixed(2)} m`;
    const vsRecord = s.recordM === null ? '' : `; lũ lịch sử ${s.recordM.toFixed(2)} m (${s.recordYear})`;
    const fc = d.series[s.id].forecast.filter((v): v is number => v !== null);
    const forecast = fc.length ? `; bản tin dự báo đỉnh ${Math.max(...fc).toFixed(2)} m` : '';
    const derived = s.derived ? ' (ước tính từ trạm khác)' : '';
    return `- ${s.name}${derived}: đỉnh ${peak.toFixed(2)} m lúc ${formatScenarioTime(d.startTime, at)}, ${vsBd3}${vsRecord}${forecast}.`;
  });
}

export const listFloodScenariosWith = (repo: FloodRepo): ToolFactory => (ctx) =>
  betaZodTool({
    name: 'list_flood_scenarios',
    description: 'List the flood scenarios (rain forecast / presets) available for Vu Gia – Thu Bồn.',
    inputSchema: z.object({}),
    run: async () => {
      const list = await repo.listScenarios(ctx.pool);
      if (list.length === 0) return NO_DATA;
      ctx.provenance({ tool: 'list_flood_scenarios', layerKey: null, rowCount: list.length, datasetVersion: basisOf('kttv-2025-10') });
      return list.map((s) => `- ${s.id}: ${s.name} — ${s.basis}; ${s.hours} giờ từ ${formatScenarioTime(s.startTime, 0)}.`).join('\n');
    },
  });

export const runFloodScenarioWith = (repo: FloodRepo): ToolFactory => (ctx) =>
  betaZodTool({
    name: 'run_flood_scenario',
    description:
      `Run a flood scenario: opens the Kịch bản lũ dock on the map at an hour (default: hour 0, the decision moment before the rise). ${HOUR_ANCHORS} Returns peak river levels vs alarm levels and records, the bulletin forecast vs what was recorded, and flooded area over time.`,
    inputSchema: z.object({ scenarioId: scenarioIdSchema, hour: z.number().int().optional() }),
    run: async (input) => {
      const d = await repo.getScenario(ctx.pool, input.scenarioId);
      if (!d) return NO_DATA;
      const hour = clampHour(input.hour ?? 0, d.hours);
      ctx.collect({ kind: 'showFloodScenario', scenarioId: d.id, hour, play: false });
      record(ctx, 'run_flood_scenario', d.id, d.stations.length);
      const peakKm2 = Math.max(...d.floodedKm2);
      const peakAt = d.floodedKm2.indexOf(peakKm2);
      const areas = d.floodedKm2
        .map((km2, h) => ({ km2, h }))
        .filter(({ h }) => h % 6 === 0)
        .map(({ km2, h }) => `${formatScenarioTime(d.startTime, h)}: ${km2.toFixed(0)} km²`);
      return [
        `${d.name}. Cơ sở: ${d.basis}; ngập là mô phỏng nhanh dựa trên địa hình và mực nước, không phải mô hình thủy lực.`,
        ...(input.hour !== undefined && input.hour !== hour
          ? [`Đã giới hạn về giờ ${hour} (${formatScenarioTime(d.startTime, hour)}).`] : []),
        `Kịch bản bắt đầu ${formatScenarioTime(d.startTime, 0)}, khi mực nước các trạm còn dưới BĐ1 (giá trị ước tính) và KTTV dự báo đỉnh lũ BĐ1–BĐ2; thực tế lên trên BĐ3. Bản tin có bảng dự báo: ${formatScenarioTime(d.startTime, d.bulletinHour)}. Đã mở kịch bản tại ${formatScenarioTime(d.startTime, hour)}.`,
        'Mực nước:',
        ...stationLines(d),
        `Diện tích ngập lớn nhất ${peakKm2.toFixed(0)} km² lúc ${formatScenarioTime(d.startTime, peakAt)}.`,
        `Diện tích ngập mỗi 6 giờ: ${areas.join('; ')}.`,
      ].join('\n');
    },
  });

export const floodImpactsWith = (repo: FloodRepo): ToolFactory => (ctx) =>
  betaZodTool({
    name: 'flood_impacts',
    description:
      `Roads cut (water ≥ 0.3 m) and xã/phường with flooded buildings BY a given hour of a flood scenario, each with the time it first flooded. ${HOUR_ANCHORS}`,
    inputSchema: z.object({ scenarioId: scenarioIdSchema, hour: z.number().int() }),
    run: async (input) => {
      const d = await repo.getImpacts(ctx.pool, input.scenarioId, input.hour);
      if (!d) return NO_DATA;
      ctx.collect({ kind: 'showFloodScenario', scenarioId: input.scenarioId, hour: d.hour, play: false });
      record(ctx, 'flood_impacts', input.scenarioId, d.totals.roadsCut + d.totals.wardsWet);
      const lines: string[] = [];
      if (d.hour !== input.hour) lines.push(`Đã giới hạn về giờ ${d.hour} (${d.time}).`);
      if (d.totals.roadsCut === 0 && d.totals.wardsWet === 0) {
        lines.push(`Đến ${d.time} chưa có tuyến đường hay xã nào bị ngập trong kịch bản này.`);
        return lines.join('\n');
      }
      lines.push(`Đến ${d.time}: khoảng ${d.totals.roadsCutKm.toLocaleString('vi-VN')} km đường bị ngập ≥ 0,3 m; ${d.totals.wardsWet} xã/phường đã bắt đầu ngập; các xã này có khoảng ${d.totals.buildingsFlooded} nhà ngập, ước tính ${d.totals.peopleEst} người (4 người/nhà, tính đến đỉnh lũ, không phải riêng đến giờ này).`);
      const byName = new Map<string, { cutTime: string; maxDepth: number; ref: string | null }>();
      for (const r of d.roads) {
        const key = r.name ?? '';
        const seen = byName.get(key);
        if (!seen) byName.set(key, { cutTime: r.cutTime, maxDepth: r.maxDepth, ref: r.ref });
        else seen.maxDepth = Math.max(seen.maxDepth, r.maxDepth);
      }
      const roads = [...byName.entries()];
      if (roads.length) lines.push('Tuyến đường (ngập từ, sâu nhất):');
      for (const [name, r] of roads.slice(0, LIST_MAX)) {
        lines.push(`- ${name}${r.ref && r.ref !== name ? ` (${r.ref})` : ''}: từ ${r.cutTime}, sâu nhất ${r.maxDepth.toFixed(1)} m`);
      }
      if (roads.length > LIST_MAX) lines.push(`- và ${roads.length - LIST_MAX} tuyến khác`);
      if (d.wards.length) lines.push('Xã/phường (bắt đầu ngập từ; số nhà, người tính đến đỉnh lũ):');
      for (const w of d.wards.slice(0, LIST_MAX)) {
        lines.push(`- ${w.name}: từ ${w.firstTime}, ${w.buildingsFlooded} nhà, ~${w.peopleEst} người, sâu nhất ${w.maxDepth.toFixed(1)} m`);
      }
      if (d.wards.length > LIST_MAX) lines.push(`- và ${d.wards.length - LIST_MAX} xã khác`);
      return lines.join('\n');
    },
  });

export const evacuationPlanWith = (repo: FloodRepo): ToolFactory => (ctx) =>
  betaZodTool({
    name: 'evacuation_plan',
    description:
      'Evacuation plan for a flood scenario: xã/phường in priority order with their deadline (3 h before flooding starts), estimated people, nearest dry gathering point and roads still open at the deadline. Draws gathering points and directions on the map.',
    inputSchema: z.object({ scenarioId: scenarioIdSchema }),
    run: async (input) => {
      const rows = await repo.getPlan(ctx.pool, input.scenarioId);
      if (!rows) return NO_DATA;
      if (rows.length === 0) return 'Kịch bản này không có xã nào cần sơ tán.';
      ctx.collect({ kind: 'showEvacuationPlan', scenarioId: input.scenarioId });
      ctx.collect({ kind: 'showFloodScenario', scenarioId: input.scenarioId, hour: Math.min(...rows.map((r) => r.deadlineHour)), play: false });
      record(ctx, 'evacuation_plan', input.scenarioId, rows.length);
      const lines = [
        'Phương án sơ tán (thứ tự ưu tiên; hướng sơ tán là đường thẳng tới điểm tập kết, không phải lộ trình):',
        ...rows.map((r) => {
          const when = r.alreadyWet ? 'đã ngập — cứu hộ' : `sơ tán xong trước ${r.deadlineTime}`;
          const kind = SHELTER_KINDS[r.shelter.kind] ?? 'điểm tập kết';
          const shelter = r.shelter.name ? `${r.shelter.name} (${kind})` : kind;
          const roads = r.openRoads.length ? `; đường còn đi được: ${r.openRoads.join(', ')}` : '; không còn tuyến đường có tên nào chưa ngập';
          return `${r.priority}. ${r.wardName}: ${when}; ~${r.peopleEst} người; tới ${shelter}, cách ${(r.distanceM / 1000).toFixed(1)} km${roads}.`;
        }),
      ];
      return lines.join('\n');
    },
  });

export const listFloodScenariosTool = listFloodScenariosWith(scenarios);
export const runFloodScenarioTool = runFloodScenarioWith(scenarios);
export const floodImpactsTool = floodImpactsWith(scenarios);
export const evacuationPlanTool = evacuationPlanWith(scenarios);

export const FLOOD_SCENARIO_IDS = ['kttv-2025-10', 'preset-500', 'preset-1000', 'preset-1300'];
export function isFloodScenarioId(value) {
    return typeof value === 'string' && FLOOD_SCENARIO_IDS.includes(value);
}
const VN_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');
/** "HH:mm DD/MM/YYYY" in Vietnam time (fixed UTC+7) for `hour` hours after `startIso`. */
export function formatScenarioTime(startIso, hour) {
    const t = new Date(Date.parse(startIso) + hour * 3600 * 1000 + VN_OFFSET_MS);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

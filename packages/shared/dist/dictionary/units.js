const DAY = 86400;
// A 365.25-day year in hours (365.25 * 24), used by the annual units below.
const YEAR_HOURS = 8766;
const YEAR_SECONDS = YEAR_HOURS * 3600;
// A calendar month is taken as 30 days; this is an approximation for monthly rates.
const MONTH_SECONDS = 30 * DAY;
const list = [
    { code: 'm', dimension: 'length', factor: 1, symbol: 'm' },
    { code: 'km', dimension: 'length', factor: 1e3, symbol: 'km' },
    { code: 'cm', dimension: 'length', factor: 1e-2, symbol: 'cm' },
    { code: 'mm', dimension: 'length', factor: 1e-3, symbol: 'mm' },
    { code: 'm2', dimension: 'area', factor: 1, symbol: 'm²' },
    { code: 'km2', dimension: 'area', factor: 1e6, symbol: 'km²' },
    { code: 'ha', dimension: 'area', factor: 1e4, symbol: 'ha' },
    { code: 'm3', dimension: 'volume', factor: 1, symbol: 'm³' },
    { code: '10*6.m3', dimension: 'volume', factor: 1e6, symbol: 'triệu m³' },
    { code: 'km3', dimension: 'volume', factor: 1e9, symbol: 'km³' },
    { code: 'L', dimension: 'volume', factor: 1e-3, symbol: 'lít' },
    { code: 'm3/s', dimension: 'flow', factor: 1, symbol: 'm³/s' },
    { code: 'L/s', dimension: 'flow', factor: 1e-3, symbol: 'l/s' },
    { code: '10*6.m3/d', dimension: 'flow', factor: 1e6 / DAY, symbol: 'triệu m³/ngày' },
    { code: 'km3/a', dimension: 'flow', factor: 1e9 / YEAR_SECONDS, symbol: 'km³/năm' },
    { code: 'W', dimension: 'power', factor: 1, symbol: 'W' },
    { code: 'kW', dimension: 'power', factor: 1e3, symbol: 'kW' },
    { code: 'MW', dimension: 'power', factor: 1e6, symbol: 'MW' },
    // Energy per year (the dam annual_output) is a mean power: 1 GWh over a 365.25-day year.
    { code: 'GW.h/a', dimension: 'power', factor: 1e9 / YEAR_HOURS, symbol: 'GWh/năm' },
    { code: 'kW.h', dimension: 'energy', factor: 3.6e6, symbol: 'kWh' },
    { code: 'MW.h', dimension: 'energy', factor: 3.6e9, symbol: 'MWh' },
    { code: 'GW.h', dimension: 'energy', factor: 3.6e12, symbol: 'GWh' },
    { code: 'mm/s', dimension: 'rate', factor: 1, symbol: 'mm/s' },
    { code: 'mm/h', dimension: 'rate', factor: 1 / 3600, symbol: 'mm/giờ' },
    { code: 'mm/d', dimension: 'rate', factor: 1 / DAY, symbol: 'mm/ngày' },
    { code: 'mm/mo', dimension: 'rate', factor: 1 / MONTH_SECONDS, symbol: 'mm/tháng' },
    // 1 kg m-2 s-1 of water is 1 mm/s, given a water density of 1000 kg/m3.
    { code: 'kg/(m2.s)', dimension: 'rate', factor: 1, symbol: 'kg/(m²·s)', assumesWaterDensity: true },
    { code: 'K', dimension: 'temperature', factor: 1, symbol: 'K' },
    { code: 'Cel', dimension: 'temperature', factor: 1, offset: 273.15, symbol: '°C' },
    { code: 'g/L', dimension: 'concentration', factor: 1, symbol: 'g/l' },
    { code: 'mg/L', dimension: 'concentration', factor: 1e-3, symbol: 'mg/l' },
    { code: 'kg/m3', dimension: 'concentration', factor: 1, symbol: 'kg/m³' },
    // Parts per thousand by mass, treated as g/L (approximate: assumes water-like density).
    { code: '[ppth]', dimension: 'concentration', factor: 1, symbol: '‰', approximate: true },
    { code: 's', dimension: 'time', factor: 1, symbol: 'giây' },
    { code: 'h', dimension: 'time', factor: 3600, symbol: 'giờ' },
    { code: 'd', dimension: 'time', factor: DAY, symbol: 'ngày' },
    { code: 'a', dimension: 'time', factor: YEAR_SECONDS, symbol: 'năm' },
    { code: '1', dimension: 'dimensionless', factor: 1, symbol: '' },
    { code: '%', dimension: 'dimensionless', factor: 0.01, symbol: '%' },
];
export const UNITS = Object.freeze(Object.fromEntries(list.map((u) => [u.code, u])));
export function unit(code) {
    const def = Object.hasOwn(UNITS, code) ? UNITS[code] : undefined;
    if (!def)
        throw new Error(`Unknown unit ${code}`);
    return def;
}
export function sameDimension(a, b) {
    return unit(a).dimension === unit(b).dimension;
}
export function convert(value, from, to) {
    const f = unit(from);
    const t = unit(to);
    if (f.dimension !== t.dimension)
        throw new Error(`Cannot convert ${from} to ${to}`);
    const base = value * f.factor + (f.offset ?? 0);
    return (base - (t.offset ?? 0)) / t.factor;
}
export function unitsOfDimension(dimension) {
    return list.filter((u) => u.dimension === dimension);
}
/** The other units of the same dimension, with 1 `code` expressed in each. Empty for offset units. */
export function commonConversions(code) {
    const def = unit(code);
    if (def.offset)
        return [];
    return unitsOfDimension(def.dimension)
        .filter((u) => u.code !== code && !u.offset)
        .map((u) => ({ to: u.code, factor: convert(1, code, u.code) }));
}

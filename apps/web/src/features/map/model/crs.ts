import proj4 from 'proj4';
import { findCrs } from '@webatlas/shared';
import { formatLonLat } from './mapReadouts';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export function projectLonLat(lonLat: number[], crsId: string): [number, number] {
  const option = findCrs(crsId);
  const [x, y] = proj4(WGS84, option.proj4, [lonLat[0], lonLat[1]]);
  return [x, y];
}

export function toDms(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = Math.round(((abs - deg) * 60 - min) * 60 * 10) / 10;
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${deg}°${String(min).padStart(2, '0')}′${sec.toFixed(1).padStart(4, '0')}″${value >= 0 ? pos : neg}`;
}

const metres = (v: number) =>
  v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Readout text in the chosen CRS. Input is WGS84 lon/lat (what MousePosition yields). */
export function formatCoordinate(lonLat: number[] | undefined, crsId: string): string {
  if (!lonLat || lonLat.length < 2) return '';
  const option = findCrs(crsId);
  if (option.kind === 'geographic') {
    const [lon, lat] = option.id.startsWith('wgs84') ? lonLat : projectLonLat(lonLat, crsId);
    if (option.format === 'dms') return `${toDms(lon, 'E', 'W')}  ${toDms(lat, 'N', 'S')}`;
    return formatLonLat([lon, lat]);
  }
  const [easting, northing] = projectLonLat(lonLat, crsId);
  // X is northing and Y easting in Vietnamese survey practice.
  return `X: ${metres(northing)} m  Y: ${metres(easting)} m`;
}

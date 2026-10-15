/**
 * Reads flood depth back from a frame pixel. Mirrors BANDS in
 * packages/atlas-data/tools/flood_scenario/depth.py: five blues, and within a band each 0.25 m step
 * adds its index in the band to red, so a pixel names its step exactly. Keep the two in step;
 * depthColour.test.ts checks this table against colours the Python build printed.
 */
export interface DepthBand { upper: number; rgb: [number, number, number]; css: string; label: string; firstStep: number }

const STEP_M = 0.25;
const MAX_STEP = 16;

export const DEPTH_BANDS: DepthBand[] = [
  { upper: 0.5, rgb: [0xbf, 0xe3, 0xf5], css: '#bfe3f5', label: '< 0,5 m', firstStep: 1 },
  { upper: 1, rgb: [0x74, 0xb9, 0xe6], css: '#74b9e6', label: '0,5–1 m', firstStep: 2 },
  { upper: 2, rgb: [0x3a, 0x86, 0xc8], css: '#3a86c8', label: '1–2 m', firstStep: 4 },
  { upper: 3, rgb: [0x1c, 0x56, 0xa0], css: '#1c56a0', label: '2–3 m', firstStep: 8 },
  { upper: Infinity, rgb: [0x0b, 0x2a, 0x6b], css: '#0b2a6b', label: '≥ 3 m', firstStep: 12 },
];

const bandOfStep = (k: number) => DEPTH_BANDS.findIndex((b) => k * STEP_M < b.upper);

/** Depth in metres (0.25 m steps, 4 = 4 m or more) a frame pixel encodes; null when dry or unknown. */
export function depthOfRgba(rgba: ArrayLike<number>): number | null {
  const [r, g, b, a] = [rgba[0], rgba[1], rgba[2], rgba[3]];
  if (a === 0) return null;
  for (let i = 0; i < DEPTH_BANDS.length; i++) {
    const band = DEPTH_BANDS[i];
    const off = r - band.rgb[0];
    const k = band.firstStep + off;
    if (g === band.rgb[1] && b === band.rgb[2] && off >= 0 && k <= MAX_STEP && bandOfStep(k) === i) return k * STEP_M;
  }
  return null;
}

/** Pixel (column, row) of a map coordinate in a frame covering `extent`; null outside it. */
export function pixelOf(extent: readonly number[], width: number, height: number, coord: readonly number[]): [number, number] | null {
  const [minx, miny, maxx, maxy] = extent;
  const [x, y] = coord;
  if (x < minx || x > maxx || y < miny || y > maxy) return null;
  const col = Math.min(width - 1, Math.floor(((x - minx) / (maxx - minx)) * width));
  const row = Math.min(height - 1, Math.floor(((maxy - y) / (maxy - miny)) * height));
  return [col, row];
}

export interface FramePixels { width: number; height: number; data: ArrayLike<number> }

export function depthAt(frame: FramePixels, extent: readonly number[], coord: readonly number[]): number | null {
  const px = pixelOf(extent, frame.width, frame.height, coord);
  if (!px) return null;
  const i = (px[1] * frame.width + px[0]) * 4;
  return depthOfRgba([frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]]);
}

export function formatDepth(m: number): string {
  return m >= MAX_STEP * STEP_M ? '≥ 4 m' : `${m.toLocaleString('vi-VN')} m`;
}

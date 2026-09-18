import type { ProfileSample } from '@webatlas/shared';

const W = 280;
const H = 110;
const PAD = 4;

/** Hand-drawn SVG: one line, min/max labels, total length. No chart library for one chart. */
export function ProfileChartView({ profile }: { profile: ProfileSample[] }) {
  const pts = profile.filter((p): p is { distanceM: number; elevationM: number } => p.elevationM !== null);
  if (pts.length < 2) return null;
  const maxD = profile[profile.length - 1].distanceM || 1;
  const minE = Math.min(...pts.map((p) => p.elevationM));
  const maxE = Math.max(...pts.map((p) => p.elevationM));
  const spanE = maxE - minE || 1;
  const x = (d: number) => PAD + (d / maxD) * (W - 2 * PAD);
  const y = (e: number) => H - PAD - ((e - minE) / spanE) * (H - 2 * PAD);
  const km = Math.round(maxD / 100) / 10;

  return (
    <figure className="profile-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Trắc diện độ cao">
        <polyline
          fill="none" stroke="#1d4ed8" strokeWidth={2}
          points={pts.map((p) => `${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`).join(' ')}
        />
      </svg>
      <figcaption className="profile-chart-axis">
        <span>{Math.round(maxE)} m</span>
        <span>{Math.round(minE)} m</span>
        <span>{km} km</span>
      </figcaption>
    </figure>
  );
}

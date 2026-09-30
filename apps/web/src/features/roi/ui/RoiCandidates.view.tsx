import type { Roi } from '@webatlas/shared';
import type { RoiCandidate } from '../model/candidates';

/** The popup's "Dùng làm vùng phân tích:" section, most specific first (U-6). */
export function RoiCandidatesView({ candidates, onUse }: { candidates: RoiCandidate[]; onUse: (roi: Roi) => void }) {
  if (candidates.length === 0) return null;
  return (
    <div className="roi-candidates">
      <div className="roi-candidates-title">Dùng làm vùng phân tích:</div>
      <ul>
        {candidates.map((c) => (
          <li key={c.key} className="roi-candidate">
            <span>{c.label}{c.detail && <span className="roi-chip-muted"> · {c.detail}</span>}</span>
            {c.roi ? (
              <button type="button" aria-label={`Dùng ${c.label} làm vùng phân tích`} onClick={() => onUse(c.roi!)}>Dùng</button>
            ) : (
              <span className="roi-chip-muted">{c.note}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

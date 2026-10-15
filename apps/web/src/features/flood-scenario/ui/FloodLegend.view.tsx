import { FLOOD_COLORS } from '../model/floodLayers';

/** Ticks at their depth on the linear 0-4 m ramp (depth.py's RAMP). */
const TICKS: [string, number][] = [['0', 0], ['0,5', 0.5], ['1', 1], ['2', 2], ['≥ 4', 4]];

/** Depth ramp, road states, plan marks and credits for the open flood scenario. */
export function FloodLegendView({ planShown }: { planShown: boolean }) {
  return (
    <section className="flood-legend" aria-label="Chú giải kịch bản lũ">
      <h3 className="flood-legend-title">Kịch bản lũ</h3>
      <p className="flood-legend-label">Độ sâu ngập (m)</p>
      <div className="flood-legend-ramp" aria-hidden="true" />
      <div className="flood-legend-ticks">
        {TICKS.map(([label, m]) => <span key={label} style={{ left: `${(m / 4) * 100}%` }}>{label}</span>)}
      </div>
      <ul className="flood-legend-rows">
        <li><span className="flood-legend-line" style={{ background: FLOOD_COLORS.cut }} />Đường chính đã ngập ≥ 0,3 m</li>
        <li><span className="flood-legend-line" style={{ background: FLOOD_COLORS.later, height: 2 }} />Đường chính sẽ ngập trong kịch bản</li>
        <li><span className="flood-legend-line" style={{ background: 'rgba(215, 48, 31, 0.45)', height: 1 }} />Đường nhỏ đã ngập</li>
        {planShown && (
          <>
            <li><span className="flood-legend-point">1</span>Điểm tập kết (số = thứ tự ưu tiên)</li>
            <li><span className="flood-legend-arrow" />Hướng sơ tán (đường thẳng, không phải lộ trình)</li>
          </>
        )}
      </ul>
      <p className="flood-legend-credit">
        Mực nước: Trung tâm Dự báo KTTV quốc gia, bản tin lũ 27–31/10/2025. Ngập: mô phỏng nhanh trên FABDEM
        (CC BY-NC-SA). Đường, nhà, trường học: © OpenStreetMap (ODbL). Dữ liệu mẫu.
      </p>
    </section>
  );
}

import { FLOOD_COLORS } from '../model/floodLayers';
import { DEPTH_BANDS } from '../model/depthColour';

/** Depth ramp, road states, plan marks and credits for the open flood scenario. */
export function FloodLegendView({ planShown }: { planShown: boolean }) {
  return (
    <section className="flood-legend" aria-label="Chú giải kịch bản lũ">
      <h3 className="flood-legend-title">Kịch bản lũ</h3>
      <p className="flood-legend-label">Độ sâu ngập (m)</p>
      <ul className="flood-legend-bands">
        {DEPTH_BANDS.map((b) => (
          <li key={b.label}><span className="flood-legend-band" style={{ background: b.css }} />{b.label}</li>
        ))}
      </ul>
      <p className="flood-legend-hint">Trỏ chuột vào vùng ngập để xem độ sâu tại chỗ.</p>
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

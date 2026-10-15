import { FLOOD_COLORS } from '../model/floodLayers';

/** Depth ramp, road states, plan marks and credits for the open flood scenario. */
export function FloodLegendView({ planShown }: { planShown: boolean }) {
  return (
    <section className="flood-legend" aria-label="Chú giải kịch bản lũ">
      <h3 className="flood-legend-title">Kịch bản lũ</h3>
      <p className="flood-legend-label">Độ sâu ngập (m)</p>
      <div className="flood-legend-ramp" aria-hidden="true" />
      <div className="flood-legend-ticks"><span>0</span><span>0,5</span><span>1</span><span>2</span><span>≥ 4</span></div>
      <ul className="flood-legend-rows">
        <li><span className="flood-legend-line" style={{ background: FLOOD_COLORS.cut }} />Đường đã ngập ≥ 0,3 m</li>
        <li><span className="flood-legend-line" style={{ background: FLOOD_COLORS.later, height: 2 }} />Đường sẽ ngập trong kịch bản</li>
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

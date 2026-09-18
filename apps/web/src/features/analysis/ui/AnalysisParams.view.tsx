import { EDITABLE_LAYER_KEYS, type AnalysisOp, type EditableLayerKey } from '@webatlas/shared';
import type { AnalysisParams } from '../model/tools';
import { ANALYSIS_TOOL_LABELS } from '../model/tools';
import type { AnalysisStatus } from '../model/useAnalysis';

const LAYER_NAMES: Record<EditableLayerKey, string> = {
  dams: 'Đập & hồ chứa', rivers: 'Sông ngòi', lakes: 'Hồ', stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt', drought_points: 'Điểm hạn hán', saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};

const HINT: Record<AnalysisOp, string> = {
  buffer: 'Vẽ hình rồi hệ thống tạo vùng đệm theo bán kính.',
  select_within: 'Vẽ một vùng để đếm và tô sáng các đối tượng nằm trong.',
  nearest: 'Chấm một điểm để tìm các đối tượng gần nhất.',
  elevation_profile: 'Vẽ một tuyến để xem trắc diện độ cao.',
  zonal_elevation: 'Vẽ một vùng (tối đa 5.000 km²) để thống kê độ cao.',
};

export interface AnalysisParamsViewProps {
  op: AnalysisOp;
  params: AnalysisParams;
  status: AnalysisStatus;
  error: string | null;
  onParams: (patch: Partial<AnalysisParams>) => void;
  onDraw: () => void;
  onUseLast: () => void;
  onCancel: () => void;
}

export function AnalysisParamsView({ op, params, status, error, onParams, onDraw, onUseLast, onCancel }: AnalysisParamsViewProps) {
  const busy = status === 'running';
  return (
    <section className="analysis-card glass-panel" aria-label={ANALYSIS_TOOL_LABELS[op]}>
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[op]}</h3>
      <p className="analysis-note">{status === 'drawing' ? 'Đang vẽ — nháy đúp để kết thúc.' : HINT[op]}</p>

      {op === 'buffer' && (
        <>
          <label>Hình vẽ
            <select value={params.shape} onChange={(e) => onParams({ shape: e.target.value as AnalysisParams['shape'] })}>
              <option value="Point">Điểm</option><option value="LineString">Đường</option><option value="Polygon">Vùng</option>
            </select>
          </label>
          <label>Bán kính (km)
            <input type="number" min={0.1} max={100} step={0.1} value={params.radiusKm}
              onChange={(e) => onParams({ radiusKm: Number(e.target.value) })} />
          </label>
        </>
      )}
      {op === 'select_within' && (
        <fieldset className="analysis-layers"><legend>Lớp cần chọn</legend>
          {EDITABLE_LAYER_KEYS.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={params.layerKeys.includes(k)}
                onChange={(e) => onParams({
                  layerKeys: e.target.checked ? [...params.layerKeys, k] : params.layerKeys.filter((x) => x !== k),
                })} />
              {LAYER_NAMES[k]}
            </label>
          ))}
        </fieldset>
      )}
      {op === 'nearest' && (
        <>
          <label>Lớp
            <select value={params.layerKey} onChange={(e) => onParams({ layerKey: e.target.value as EditableLayerKey })}>
              {EDITABLE_LAYER_KEYS.map((k) => <option key={k} value={k}>{LAYER_NAMES[k]}</option>)}
            </select>
          </label>
          <label>Số đối tượng
            <input type="number" min={1} max={25} value={params.k} onChange={(e) => onParams({ k: Number(e.target.value) })} />
          </label>
        </>
      )}

      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onDraw} disabled={busy || (op === 'select_within' && params.layerKeys.length === 0)}>
          {busy ? 'Đang tính…' : 'Vẽ trên bản đồ'}
        </button>
        <button type="button" onClick={onUseLast} disabled={busy}>Dùng hình vừa vẽ</button>
        <button type="button" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  );
}

import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import type { RoiTool } from '../../roi/model/toolAvailability';
import { ANALYSIS_TOOL_LABELS, type AnalysisParams } from '../model/tools';
import type { AnalysisStatus } from '../model/useAnalysis';

const LAYER_NAMES: Record<EditableLayerKey, string> = {
  dams: 'Đập & hồ chứa', rivers: 'Sông ngòi', lakes: 'Hồ', stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt', drought_points: 'Điểm hạn hán', saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};

const HINT: Record<RoiTool, string> = {
  select_within: 'Đếm và tô sáng các đối tượng nằm trong vùng phân tích.',
  zonal_elevation: 'Độ cao thấp nhất, cao nhất và trung bình trong vùng (tối đa 5.000 km²).',
  elevation_profile: 'Trắc diện độ cao dọc theo tuyến.',
  nearest: 'Các đối tượng gần nhất, tính từ điểm — hoặc từ trọng tâm nếu vùng phân tích là đường hay vùng.',
};

export interface AnalysisParamsViewProps {
  tool: RoiTool;
  roiLabel: string | null;
  params: AnalysisParams;
  status: AnalysisStatus;
  error: string | null;
  onParams: (patch: Partial<AnalysisParams>) => void;
  onRun: () => void;
  onCancel: () => void;
}

/** Only the tool's own parameters: the ROI is already chosen, so there is no draw step. */
export function AnalysisParamsView({ tool, roiLabel, params, status, error, onParams, onRun, onCancel }: AnalysisParamsViewProps) {
  const busy = status === 'running';
  return (
    <section className="analysis-card glass-panel" aria-label={ANALYSIS_TOOL_LABELS[tool]}>
      <h3 className="analysis-card-title">{ANALYSIS_TOOL_LABELS[tool]}</h3>
      {roiLabel && <p className="analysis-note">Vùng phân tích: {roiLabel}</p>}
      <p className="analysis-note">{HINT[tool]}</p>

      {tool === 'select_within' && (
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
      {tool === 'nearest' && (
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
      {tool === 'elevation_profile' && (
        <label>Số điểm lấy mẫu
          <input type="number" min={2} max={200} value={params.samples}
            onChange={(e) => onParams({ samples: Number(e.target.value) })} />
        </label>
      )}

      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button type="button" onClick={onRun} disabled={busy || (tool === 'select_within' && params.layerKeys.length === 0)}>
          {busy ? 'Đang tính…' : 'Chạy'}
        </button>
        <button type="button" onClick={onCancel}>Huỷ</button>
      </div>
    </section>
  );
}

import type { AnalysisOp, EditableLayerKey, Roi } from '@webatlas/shared';
import type { RoiTool } from '../../roi/model/toolAvailability';

/** Every op keeps its label: result cards and the print page name results by op. */
export const ANALYSIS_TOOL_LABELS: Record<AnalysisOp, string> = {
  buffer: 'Vùng đệm',
  select_within: 'Chọn trong vùng',
  nearest: 'Gần nhất',
  elevation_profile: 'Trắc diện độ cao',
  zonal_elevation: 'Thống kê độ cao',
};

export interface AnalysisParams {
  layerKeys: EditableLayerKey[];
  layerKey: EditableLayerKey;
  k: number;
  samples: number;
}

export const DEFAULT_PARAMS: AnalysisParams = { layerKeys: ['dams'], layerKey: 'dams', k: 5, samples: 100 };

/** The request body: the ROI as it is, plus the tool's own parameters (spec §8). */
export function buildInput(tool: RoiTool, params: AnalysisParams, roi: Roi): object {
  switch (tool) {
    case 'select_within': return { roi, layerKeys: params.layerKeys };
    case 'nearest': return { roi, layerKey: params.layerKey, k: params.k };
    case 'elevation_profile': return { roi, samples: params.samples };
    case 'zonal_elevation': return { roi };
  }
}

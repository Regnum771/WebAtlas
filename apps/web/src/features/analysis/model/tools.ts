import type { AnalysisOp, EditableLayerKey, GeoJsonGeometry } from '@webatlas/shared';
import type { DrawKind } from '../../map/model/analysisDraw';

export const ANALYSIS_TOOL_LABELS: Record<AnalysisOp, string> = {
  buffer: 'Vùng đệm',
  select_within: 'Chọn trong vùng',
  nearest: 'Gần nhất',
  elevation_profile: 'Trắc diện độ cao',
  zonal_elevation: 'Thống kê độ cao',
};

export interface AnalysisParams {
  /** Buffer only: what the user draws. */
  shape: DrawKind;
  radiusKm: number;
  layerKeys: EditableLayerKey[];
  layerKey: EditableLayerKey;
  k: number;
  samples: number;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  shape: 'Point', radiusKm: 5, layerKeys: ['dams'], layerKey: 'dams', k: 5, samples: 100,
};

export function drawKindFor(op: AnalysisOp, params: AnalysisParams): DrawKind {
  switch (op) {
    case 'buffer': return params.shape;
    case 'nearest': return 'Point';
    case 'elevation_profile': return 'LineString';
    case 'select_within':
    case 'zonal_elevation': return 'Polygon';
  }
}

const FAMILY: Record<DrawKind, GeoJsonGeometry['type'][]> = {
  Point: ['Point'],
  LineString: ['LineString', 'MultiLineString'],
  Polygon: ['Polygon', 'MultiPolygon'],
};

export function acceptsShape(op: AnalysisOp, params: AnalysisParams, g: GeoJsonGeometry): boolean {
  if (op === 'buffer') return true; // any shape can be buffered
  return FAMILY[drawKindFor(op, params)].includes(g.type);
}

export function buildInput(op: AnalysisOp, params: AnalysisParams, g: GeoJsonGeometry): object {
  // Until the ROI chip lands (Task 10), the toolbar still draws per tool; it sends that
  // drawing as a drawn ROI. buffer keeps its own body (spec C-9).
  const roi = { source: 'drawn' as const, geometry: g };
  switch (op) {
    case 'buffer': return { geometry: g, radiusKm: params.radiusKm };
    case 'select_within': return { roi, layerKeys: params.layerKeys };
    case 'nearest': return { roi, layerKey: params.layerKey, k: params.k };
    case 'elevation_profile': return { roi, samples: params.samples };
    case 'zonal_elevation': return { roi };
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';
import { useSelection } from '../../../entities/selection';
import { usePersona } from '../../../entities/persona/usePersona';
import { LAYER_LABELS } from '../../../features/attribute-filter/model/layerLabels';

export interface DisplayRow {
  iso: string;
  label: string;
  value: string;
}

/**
 * Vietnamese labels for the ISO attribute names, so the panel does not show raw db
 * column names. Reuses the wording already in LAYER_FILTER_FIELDS where they overlap;
 * anything unlisted falls back to the db column name.
 */
const FIELD_LABELS: Record<string, string> = {
  geographicalName: 'Tên',
  geographicalNameEn: 'Tên tiếng Anh',
  ratedPower: 'Công suất (MW)',
  annualGeneration: 'Sản lượng năm',
  constructionYear: 'Năm khởi công',
  commissioningYear: 'Năm vận hành',
  operationalStatus: 'Trạng thái',
  hydroId: 'Mã sông',
  streamOrder: 'Cấp sông',
  length: 'Chiều dài (m)',
  measurementType: 'Loại trạm',
  measurementValue: 'Giá trị đo',
  hazardType: 'Loại hiểm họa',
  affectedArea: 'Diện tích ảnh hưởng',
  riskLevel: 'Mức rủi ro',
  observedStatus: 'Trạng thái',
  observationDate: 'Ngày khảo sát',
  salinity: 'Độ mặn',
  catchmentArea: 'Diện tích lưu vực',
};

export function useDisplayPanelPresenter() {
  const { selection, clear } = useSelection();
  const { available } = usePersona();
  const [collapsed, setCollapsed] = useState(false);

  // A NEW selection always re-expands: clicking a result must show what you clicked.
  // Collapsing is a per-feature preference, not a sticky mode.
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selection ? `${selection.layerKey}:${selection.featureId}` : null;
    if (id !== lastIdRef.current) {
      lastIdRef.current = id;
      if (id) setCollapsed(false);
    }
  }, [selection]);

  const rows: DisplayRow[] = useMemo(() => {
    if (!selection) return [];
    // LAYER_ATTRIBUTE_MAP[key].attributes is Record<dbColumn, isoName> — bare strings,
    // verified in packages/shared/src/layer-attributes.ts. Features carry the ISO names.
    const isoByColumn = LAYER_ATTRIBUTE_MAP[selection.layerKey].attributes;
    const out: DisplayRow[] = [];
    for (const [column, iso] of Object.entries(isoByColumn)) {
      // Identity columns are noise in a read-only view.
      if (iso === 'localId') continue;
      const v = selection.isoProps[iso];
      if (v === undefined || v === null || v === '') continue;
      out.push({ iso, label: FIELD_LABELS[iso] ?? column, value: String(v) });
    }
    return out;
  }, [selection]);

  const title = selection
    ? String(selection.isoProps.geographicalName ?? selection.isoProps.localId ?? selection.featureId)
    : '';

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);

  return {
    visible: selection !== null,
    collapsed,
    title,
    layerLabel: selection ? LAYER_LABELS[selection.layerKey] : '',
    rows,
    // UX routing only — the backend authorises every write regardless.
    canEdit: available.includes('steward'),
    toggleCollapse,
    close: clear,
  };
}

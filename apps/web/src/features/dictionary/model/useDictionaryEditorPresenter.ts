import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { unit, unitsOfDimension, type GeometryMeaning } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import {
  fetchHistory, fetchLayerEntry, patchAttribute, patchLayer, restoreFields,
  type HistoryEntry, type RevisedAttribute, type RevisedFeatureType,
} from '../api/dictionaryEdit.api';
import type { EditorFormView, EditorProps, FormFieldView } from '../ui/DictionaryEditor.view';
import type { HistoryRowView } from '../ui/DictionaryHistory.view';
import { isCurrent } from './isCurrent';
import { useDictionary } from './useDictionary';

type Draft = Record<string, string | string[]>;

const STRUCTURE_HINT = 'theo cấu trúc dữ liệu';
const CHANGED = 'Mục này vừa được người khác sửa.';

const MEANING_LABEL: Record<GeometryMeaning, string> = {
  exact: 'Chính xác',
  approximate: 'Gần đúng',
  representativePoint: 'Điểm đại diện',
};

const REASON_LABEL: Record<HistoryEntry['reason'], string> = {
  edit: 'sửa',
  restore: 'khôi phục',
  sync_revert: 'đồng bộ hoàn nguyên',
  sync_retire: 'đồng bộ ngừng dùng',
};

/** Vietnamese names of the fields, for the history panel. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Tên', definition: 'Định nghĩa', geometryMeaning: 'Ý nghĩa hình học', validTo: 'Ngừng dùng từ',
  label: 'Nhãn', displayUnit: 'Đơn vị hiển thị', displayUnits: 'Đơn vị hiển thị được phép',
  precision: 'Số chữ số thập phân', cfStandardName: 'Tên chuẩn CF', valueType: 'Kiểu giá trị', storedUnit: 'Đơn vị lưu',
  code: 'Mã', colorHint: 'Màu gợi ý', retired: 'Ngừng dùng',
};

const LAYER_FIELDS = ['name', 'definition', 'geometryMeaning', 'validTo'] as const;
const ATTRIBUTE_FIELDS = ['label', 'definition', 'displayUnit', 'displayUnits', 'precision', 'cfStandardName', 'validTo'] as const;

const symbolOf = (code: string) => {
  try { return unit(code).symbol; } catch { return code; }
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (field === 'geometryMeaning' && typeof value === 'string' && value in MEANING_LABEL) {
    return MEANING_LABEL[value as GeometryMeaning];
  }
  if (typeof value === 'boolean') return value ? 'có' : 'không';
  return String(value);
}

const formatTime = (iso: string) => new Date(iso).toLocaleString('vi-VN');

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** The draft as the stored entry has it. */
function baseDraft(layer: boolean, e: RevisedFeatureType | RevisedAttribute): Draft {
  if (layer) {
    const f = e as RevisedFeatureType;
    return { name: f.name, definition: f.definition, geometryMeaning: f.geometryMeaning, validTo: f.validTo ?? '' };
  }
  const a = e as RevisedAttribute;
  return {
    label: a.label,
    definition: a.definition,
    displayUnit: a.displayUnit ?? '',
    displayUnits: a.displayUnits ?? [],
    precision: a.precision === undefined ? '' : String(a.precision),
    cfStandardName: a.cfStandardName ?? '',
    validTo: a.validTo ?? '',
  };
}

/** The request body of the fields that differ from the stored entry. */
function diff(keys: readonly string[], base: Draft, draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of keys) {
    const b = base[k];
    const d = draft[k];
    if (Array.isArray(b) && Array.isArray(d) ? sameList(b, d) : b === d) continue;
    if (k === 'precision') body[k] = d === '' ? '' : Number(d);
    else if (k === 'cfStandardName' || k === 'validTo') body[k] = d === '' ? null : d;
    else body[k] = d;
  }
  return body;
}

export interface DictionaryEditorPresenter {
  editor: EditorProps;
  history: { rows: HistoryRowView[]; loading: boolean; truncated: boolean };
}

const HISTORY_LIMIT = 200;

/** The /quan-ly/tu-dien section: picks a layer and an attribute, edits, saves and restores. */
export function useDictionaryEditorPresenter(): DictionaryEditorPresenter {
  const dictionary = useDictionary();
  const client = useQueryClient();
  const layers = useMemo(() => Object.values(dictionary).map((f) => ({ key: f.key, name: f.name })), [dictionary]);

  const [pickedLayer, setPickedLayer] = useState<string | null>(null);
  const layerKey = pickedLayer && Object.hasOwn(dictionary, pickedLayer) ? pickedLayer : (layers[0]?.key ?? '');
  const [attributeName, setAttributeName] = useState<string | null>(null);

  // Touched fields only, keyed by form and the revision they were typed against: a reload drops them.
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  // Feedback belongs to one form: '' is the feature-type form, otherwise the attribute name.
  const [feedback, setFeedback] = useState<{ form: string; message: string | null; errors: Record<string, string> } | null>(null);

  const entryQuery = useQuery({
    queryKey: ['dictionary', 'entry', layerKey],
    queryFn: () => fetchLayerEntry(layerKey),
    enabled: layerKey !== '',
    refetchOnWindowFocus: false,
  });
  // Layer-wide history feeds the feature-type form. With an attribute chosen, its own (scoped) query
  // feeds that form and the history panel, so a busy layer cannot push its rows out of the limit.
  const layerHistory = useQuery({
    queryKey: ['dictionary', 'history', layerKey],
    queryFn: () => fetchHistory(layerKey, null, HISTORY_LIMIT),
    enabled: layerKey !== '',
    refetchOnWindowFocus: false,
  });
  const attributeHistory = useQuery({
    queryKey: ['dictionary', 'history', layerKey, attributeName],
    queryFn: () => fetchHistory(layerKey, attributeName, HISTORY_LIMIT),
    enabled: layerKey !== '' && attributeName !== null,
    refetchOnWindowFocus: false,
  });

  const entry = entryQuery.data;

  const selectLayer = (key: string) => { setPickedLayer(key); setAttributeName(null); setFeedback(null); };
  const selectAttribute = (name: string | null) => { setAttributeName(name); setFeedback(null); };

  const reload = () => client.invalidateQueries({ queryKey: ['dictionary'] });

  async function run(form: string, editKey: string, work: () => Promise<unknown>) {
    setSaving(form);
    setFeedback(null);
    const dropEdits = () => setEdits((prev) => { const { [editKey]: _gone, ...rest } = prev; return rest; });
    try {
      await work();
      dropEdits();
      await reload();
    } catch (e) {
      const field = e instanceof ApiError ? (e.details as { field?: string } | undefined)?.field : undefined;
      if (e instanceof ApiError && e.status === 409) {
        setFeedback({ form, message: CHANGED, errors: {} });
        dropEdits();
        await reload();
      } else if (e instanceof ApiError && e.status === 400 && field) {
        setFeedback({ form, message: null, errors: { [field]: e.message } });
      } else {
        setFeedback({ form, message: e instanceof Error ? e.message : 'Không lưu được.', errors: {} });
      }
    } finally {
      setSaving(null);
    }
  }

  /** One form: the feature type (`name` null) or one attribute. */
  function buildForm(name: string | null): EditorFormView | null {
    const isLayerForm = name === null;
    const target: RevisedFeatureType | RevisedAttribute | undefined = isLayerForm
      ? entry : entry?.attributes.find((a) => a.name === name);
    if (!target) return null;
    const formId = name ?? '';
    const keys: readonly string[] = isLayerForm ? LAYER_FIELDS : ATTRIBUTE_FIELDS;
    const base = baseDraft(isLayerForm, target);
    const editKey = `${layerKey}|${formId}|${target.revision}`;
    const draft: Draft = { ...base, ...edits[editKey] };
    const body = diff(keys, base, draft);
    const dirty = Object.keys(body).length > 0;

    // A field is "edited" when its newest history row for (attribute, field) is a staff edit.
    const source = isLayerForm
      ? (layerHistory.data ?? []).filter((h) => h.attribute === null)
      : (attributeHistory.data ?? []);
    const latest = new Map<string, HistoryEntry>();
    for (const h of source) {
      if (h.code === null && !latest.has(h.field)) latest.set(h.field, h);
    }
    const editedOf = (field: string) => {
      const h = latest.get(field);
      return h && h.reason === 'edit' ? h : undefined;
    };
    const editedKeys = keys.filter((k) => editedOf(k));

    const mine = feedback?.form === formId ? feedback : null;
    const fields = (isLayerForm ? layerFields(target as RevisedFeatureType, draft) : attributeFields(target as RevisedAttribute, draft))
      .map((f) => {
        const h = keys.includes(f.key) ? editedOf(f.key) : undefined;
        return {
          ...f,
          error: mine?.errors[f.key],
          edited: h ? `Đã sửa bởi ${h.changedBy?.name ?? 'không rõ'} lúc ${formatTime(h.changedAt)}` : undefined,
        };
      });

    const restore = (list: string[]) => {
      if (list.length === 0) return;
      void run(formId, editKey, () => restoreFields(layerKey, name, list));
    };
    return {
      idPrefix: isLayerForm ? 'dict-layer-form' : 'dict-attr',
      title: isLayerForm ? 'Thông tin lớp' : (target as RevisedAttribute).label,
      fields,
      dirty,
      saving: saving === formId,
      message: mine?.message ?? null,
      canRestoreAll: editedKeys.length > 0,
      onChange: (key, value) => {
        const next: Draft = { ...edits[editKey], [key]: value };
        // The shown unit must stay one of the permitted units.
        if (key === 'displayUnits' && Array.isArray(value) && !isLayerForm) {
          const shown = draft.displayUnit as string;
          if (value.length > 0 && !value.includes(shown)) next.displayUnit = value[0];
        }
        setEdits((prev) => ({ ...prev, [editKey]: next }));
        setFeedback((prev) => {
          if (!prev || prev.form !== formId || !(key in prev.errors)) return prev;
          const { [key]: _gone, ...rest } = prev.errors;
          return { ...prev, errors: rest };
        });
      },
      onSave: () => {
        if (!dirty) return;
        const payload = { expectedRevision: target.revision, ...body };
        void run(formId, editKey, () => (isLayerForm
          ? patchLayer(layerKey, payload)
          : patchAttribute(layerKey, name!, payload)));
      },
      onRestore: (key) => restore([key]),
      onRestoreAll: () => restore([...editedKeys]),
    };
  }

  const labelOfAttribute = (name: string) => entry?.attributes.find((a) => a.name === name)?.label ?? name;
  const panel = attributeName === null ? layerHistory : attributeHistory;
  const historyRows: HistoryRowView[] = (panel.data ?? []).map((h) => {
    const field = FIELD_LABEL[h.field] ?? h.field;
    const owner = h.attribute === null ? '' : `${labelOfAttribute(h.attribute)} · `;
    const value = h.code === null ? '' : `Giá trị "${h.code}" · `;
    return {
      id: h.id,
      who: h.changedBy?.name ?? 'Hệ thống',
      when: formatTime(h.changedAt),
      field: `${owner}${value}${field}`,
      change: `${formatValue(h.field, h.oldValue)} → ${formatValue(h.field, h.newValue)}`,
      reason: REASON_LABEL[h.reason] ?? h.reason,
    };
  });

  return {
    editor: {
      layers,
      layerKey,
      onLayer: selectLayer,
      attributes: (entry?.attributes ?? []).map((a) => ({ name: a.name, label: a.label, retired: !isCurrent(a.validTo) })),
      attributeName,
      onAttribute: selectAttribute,
      loading: entryQuery.isPending && layerKey !== '',
      error: entryQuery.isError ? 'Không tải được mục từ điển.' : null,
      onRetry: () => { void entryQuery.refetch(); },
      layerForm: buildForm(null),
      attributeForm: attributeName === null ? null : buildForm(attributeName),
    },
    history: {
      rows: historyRows,
      loading: panel.isPending && panel.fetchStatus !== 'idle' && layerKey !== '',
      truncated: (panel.data?.length ?? 0) >= HISTORY_LIMIT,
    },
  };
}

function layerFields(f: RevisedFeatureType, d: Draft): FormFieldView[] {
  return [
    { key: 'name', label: 'Tên lớp', kind: 'text', value: d.name as string },
    { key: 'definition', label: 'Định nghĩa', kind: 'textarea', value: d.definition as string },
    {
      key: 'geometryMeaning', label: 'Ý nghĩa hình học', kind: 'select', value: d.geometryMeaning as string,
      options: (Object.keys(MEANING_LABEL) as GeometryMeaning[]).map((m) => ({ value: m, label: MEANING_LABEL[m] })),
    },
    {
      key: 'validTo', label: 'Ngừng dùng từ', kind: 'date', value: d.validTo as string, clearable: true,
      hint: isCurrent(f.validTo ?? undefined) && !d.validTo ? 'Để trống nếu lớp còn dùng.' : undefined,
    },
    { key: 'kind', label: 'Loại dữ liệu', kind: 'locked', value: f.kind === 'vector' ? 'Lớp vectơ' : 'Lớp ảnh', hint: STRUCTURE_HINT },
    ...(f.table ? [{ key: 'table', label: 'Bảng dữ liệu', kind: 'locked' as const, value: f.table, hint: STRUCTURE_HINT }] : []),
    { key: 'crs', label: 'Hệ toạ độ', kind: 'locked', value: `EPSG:${f.crs}`, hint: STRUCTURE_HINT },
    ...(f.geometryType ? [{ key: 'geometryType', label: 'Kiểu hình học', kind: 'locked' as const, value: f.geometryType, hint: STRUCTURE_HINT }] : []),
  ];
}

function attributeFields(a: RevisedAttribute, d: Draft): FormFieldView[] {
  const permitted = d.displayUnits as string[];
  let dimensionUnits: { value: string; label: string }[] = [];
  if (a.storedUnit) {
    try {
      dimensionUnits = unitsOfDimension(unit(a.storedUnit).dimension).map((u) => ({ value: u.code, label: u.symbol }));
    } catch { /* an unknown stored unit offers no choices */ }
  }
  const fields: FormFieldView[] = [
    { key: 'label', label: 'Nhãn', kind: 'text', value: d.label as string },
    { key: 'definition', label: 'Định nghĩa', kind: 'textarea', value: d.definition as string },
  ];
  if (a.storedUnit) {
    fields.push(
      {
        key: 'displayUnit', label: 'Đơn vị hiển thị', kind: 'select', value: d.displayUnit as string,
        options: permitted.map((c) => ({ value: c, label: symbolOf(c) })),
      },
      { key: 'displayUnits', label: 'Đơn vị hiển thị được phép', kind: 'checks', value: '', selected: permitted, options: dimensionUnits },
    );
  }
  if (a.valueType === 'number') {
    fields.push({ key: 'precision', label: 'Số chữ số thập phân', kind: 'number', value: d.precision as string, min: 0, max: 6, step: 1 });
  }
  fields.push(
    { key: 'cfStandardName', label: 'Tên chuẩn CF', kind: 'text', value: d.cfStandardName as string },
    { key: 'validTo', label: 'Ngừng dùng từ', kind: 'date', value: d.validTo as string, clearable: true },
    { key: 'name', label: 'Tên cột', kind: 'locked', value: a.name, hint: STRUCTURE_HINT },
    { key: 'source', label: 'Nguồn', kind: 'locked', value: a.source, hint: STRUCTURE_HINT },
    { key: 'valueType', label: 'Kiểu giá trị', kind: 'locked', value: a.valueType, hint: STRUCTURE_HINT },
  );
  if (a.storedUnit) {
    fields.push({ key: 'storedUnit', label: 'Đơn vị lưu', kind: 'locked', value: symbolOf(a.storedUnit) });
  }
  return fields;
}

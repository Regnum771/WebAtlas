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
  history: { rows: HistoryRowView[]; loading: boolean };
}

/** The /quan-ly/tu-dien section: picks a layer and an attribute, edits, saves and restores. */
export function useDictionaryEditorPresenter(): DictionaryEditorPresenter {
  const dictionary = useDictionary();
  const client = useQueryClient();
  const layers = useMemo(() => Object.values(dictionary).map((f) => ({ key: f.key, name: f.name })), [dictionary]);

  const [pickedLayer, setPickedLayer] = useState<string | null>(null);
  const layerKey = pickedLayer && Object.hasOwn(dictionary, pickedLayer) ? pickedLayer : (layers[0]?.key ?? '');
  const [attributeName, setAttributeName] = useState<string | null>(null);

  // Touched fields only, tied to the revision they were typed against: a reload drops them.
  const [edits, setEdits] = useState<{ key: string; values: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const entryQuery = useQuery({
    queryKey: ['dictionary', 'entry', layerKey],
    queryFn: () => fetchLayerEntry(layerKey),
    enabled: layerKey !== '',
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ['dictionary', 'history', layerKey],
    queryFn: () => fetchHistory(layerKey, 200),
    enabled: layerKey !== '',
    refetchOnWindowFocus: false,
  });

  const entry = entryQuery.data;
  const attribute = entry && attributeName !== null ? entry.attributes.find((a) => a.name === attributeName) : undefined;
  const target: RevisedFeatureType | RevisedAttribute | undefined = attributeName === null ? entry : attribute;
  const isLayerForm = attributeName === null;

  const clearFeedback = () => { setMessage(null); setErrors({}); };
  const selectLayer = (key: string) => { setPickedLayer(key); setAttributeName(null); setEdits(null); clearFeedback(); };
  const selectAttribute = (name: string | null) => { setAttributeName(name); setEdits(null); clearFeedback(); };

  // A field is "edited" when its newest history row for (attribute, field) is a staff edit.
  const editedBy = useMemo(() => {
    const map = new Map<string, HistoryEntry>();
    for (const h of historyQuery.data ?? []) {
      if (h.code !== null) continue;
      const k = `${h.attribute ?? ''}\u0000${h.field}`;
      if (!map.has(k)) map.set(k, h);
    }
    return map;
  }, [historyQuery.data]);
  const editedOf = useCallback((field: string) => {
    const h = editedBy.get(`${attributeName ?? ''}\u0000${field}`);
    return h && h.reason === 'edit' ? h : undefined;
  }, [editedBy, attributeName]);

  const keys: readonly string[] = isLayerForm ? LAYER_FIELDS : ATTRIBUTE_FIELDS;
  const base = useMemo(() => (target ? baseDraft(isLayerForm, target) : null), [target, isLayerForm]);
  const editKey = `${layerKey}|${attributeName ?? ''}|${target?.revision ?? ''}`;
  const draft: Draft | null = base ? { ...base, ...(edits?.key === editKey ? edits.values : {}) } : null;
  const body = base && draft ? diff(keys, base, draft) : {};
  const dirty = Object.keys(body).length > 0;

  const reload = () => client.invalidateQueries({ queryKey: ['dictionary'] });

  async function run(work: () => Promise<unknown>) {
    setSaving(true);
    clearFeedback();
    try {
      await work();
      setEdits(null);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage(CHANGED);
        setEdits(null);
        await reload();
      } else if (e instanceof ApiError && e.status === 400 && (e.details as { field?: string } | undefined)?.field) {
        setErrors({ [(e.details as { field: string }).field]: e.message });
      } else {
        setMessage(e instanceof Error ? e.message : 'Không lưu được.');
      }
    } finally {
      setSaving(false);
    }
  }

  const onChange = (key: string, value: string | string[]) => {
    if (!draft) return;
    setErrors((prev) => { const { [key]: _gone, ...rest } = prev; return rest; });
    setEdits({ key: editKey, values: { ...(edits?.key === editKey ? edits.values : {}), [key]: value } });
  };

  const onSave = () => {
    if (!target || !dirty) return;
    const payload = { expectedRevision: target.revision, ...body };
    void run(() => (isLayerForm ? patchLayer(layerKey, payload) : patchAttribute(layerKey, attributeName!, payload)));
  };

  const restore = (fields: string[]) => {
    if (fields.length === 0) return;
    void run(() => restoreFields(layerKey, attributeName, fields));
  };

  const editedKeys = keys.filter((k) => editedOf(k));

  const form: EditorFormView | null = target && draft ? {
    title: isLayerForm ? 'Thông tin lớp' : (target as RevisedAttribute).label,
    fields: isLayerForm
      ? layerFields(target as RevisedFeatureType, draft)
      : attributeFields(target as RevisedAttribute, draft),
    dirty, saving, message,
    canRestoreAll: editedKeys.length > 0,
    onChange, onSave,
    onRestore: (key) => restore([key]),
    onRestoreAll: () => restore([...editedKeys]),
  } : null;
  if (form) {
    form.fields = form.fields.map((f) => {
      const h = keys.includes(f.key) ? editedOf(f.key) : undefined;
      return {
        ...f,
        error: errors[f.key],
        edited: h ? `Đã sửa bởi ${h.changedBy?.name ?? 'không rõ'} lúc ${formatTime(h.changedAt)}` : undefined,
      };
    });
  }

  const labelOfAttribute = (name: string) => entry?.attributes.find((a) => a.name === name)?.label ?? name;
  const historyRows: HistoryRowView[] = (historyQuery.data ?? []).map((h) => {
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
      form,
    },
    history: { rows: historyRows, loading: historyQuery.isPending && layerKey !== '' },
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
    fields.push({ key: 'precision', label: 'Số chữ số thập phân', kind: 'number', value: d.precision as string });
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

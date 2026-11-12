import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { refusalOf } from '../../../shared/api/refusal';
import { updateFeature } from '../../feature-editing/api/features.api';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';
import { fetchUnassigned, type UnassignedFeature } from '../api/unassigned.api';

export function layerLabel(key: UnassignedFeature['layerKey']): string {
  return LAYER_DISPLAY[LAYER_ATTRIBUTE_MAP[key].layerStateId]?.name ?? key;
}

export function useUnassignedPresenter() {
  const query = useQuery({ queryKey: ['unassigned-features'], queryFn: fetchUnassigned });
  const [target, setTarget] = useState<UnassignedFeature | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** A second line under `saveError`: the missing review right of a refusal (refusalOf). */
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null);

  const open = useCallback((row: UnassignedFeature) => { setSaveError(null); setSaveErrorDetail(null); setTarget(row); }, []);
  const close = useCallback(() => { if (!saving) setTarget(null); }, [saving]);

  const assign = useCallback(async (unit: string) => {
    if (!target || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveErrorDetail(null);
    try {
      await updateFeature(target.layerKey, target.id, { properties: { managing_unit: unit } });
      setTarget(null);
      await query.refetch();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Chưa lưu được. Thử lại.');
      setSaveErrorDetail(refusalOf(e)?.detail ?? null);
    } finally {
      setSaving(false);
    }
  }, [target, saving, query]);

  return {
    rows: query.data?.features ?? [],
    loading: query.isPending,
    failed: query.isError && !query.data,
    retry: () => { void query.refetch(); },
    target, open, close, assign, saving, saveError, saveErrorDetail,
  };
}

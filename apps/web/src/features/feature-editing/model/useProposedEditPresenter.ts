import { useCallback, useMemo, useState } from 'react';
import { LAYER_ATTRIBUTE_MAP, editableColumns, type FeatureEditProposal } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { updateFeature } from '../api/features.api';

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'Bạn không có quyền cập nhật.';
    if (e.status === 404) return 'Đối tượng không còn tồn tại.';
    if (e.status === 400) return e.message;
  }
  return 'Không lưu được, vui lòng thử lại.';
}

export function useProposedEditPresenter(
  proposal: FeatureEditProposal,
  { onSaved }: { onSaved: (changedCount: number) => void }
) {
  const columns = useMemo(() => editableColumns(proposal.layerKey), [proposal.layerKey]);
  const labels = useMemo(() => {
    const iso = LAYER_ATTRIBUTE_MAP[proposal.layerKey].attributes;
    return Object.fromEntries(columns.map((c) => [c, iso[c] ?? c]));
  }, [proposal.layerKey, columns]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      columns.map((c) => [c, (c in proposal.proposed ? proposal.proposed[c] : proposal.current[c]) ?? ''])
    )
  );
  const [sourceDocument, setSourceDocument] = useState(proposal.sourceDocument ?? '');
  const [sourceProvider, setSourceProvider] = useState(proposal.sourceProvider ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previous = useCallback((c: string) => proposal.current[c] ?? '', [proposal]);
  const isChanged = useCallback((c: string) => values[c] !== previous(c), [values, previous]);
  const changed = columns.filter(isChanged);

  const canSave =
    !saving && changed.length > 0 && sourceDocument.trim() !== '' && sourceProvider.trim() !== '';

  const setField = useCallback((c: string, v: string) => setValues((prev) => ({ ...prev, [c]: v })), []);

  const submit = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const properties = Object.fromEntries(changed.map((c) => [c, values[c] === '' ? null : values[c]]));
      await updateFeature(proposal.layerKey, proposal.featureId, {
        properties,
        source: { document: sourceDocument.trim(), provider: sourceProvider.trim() },
      });
      onSaved(changed.length);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setSaving(false);
    }
  }, [canSave, changed, values, proposal, sourceDocument, sourceProvider, onSaved]);

  return {
    columns, labels, values, setField, isChanged, previous,
    sourceDocument, setSourceDocument, sourceProvider, setSourceProvider,
    canSave, saving, error, submit,
  };
}

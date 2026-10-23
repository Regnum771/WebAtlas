import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/workspace.api';
import { updateUser } from '../../user-management/api/users.api';
import type { OwnerSummary } from '../api/workspace.api';

/** One binary gigabyte, as formatBytes counts it. */
export const GB = 1073741824;

export interface UsageRow extends OwnerSummary {
  /** Usage at or over the quota. */
  overQuota: boolean;
}

/** Parses a GB amount typed with a point or a comma; null when it is not a non-negative number. */
export function parseGb(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Admin view of personal-map usage per owner, with quota editing. Never touches map content. */
export function useUsagePresenter() {
  const query = useQuery({ queryKey: ['ws', 'admin-summary'], queryFn: api.adminSummary });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = useMemo<UsageRow[]>(
    () =>
      [...(query.data ?? [])]
        .sort((a, b) => b.usageBytes - a.usageBytes)
        .map((o) => ({ ...o, overQuota: o.usageBytes >= o.quotaBytes })),
    [query.data]
  );

  const canSave = parseGb(draft) !== null;

  function startEdit(userId: string) {
    const row = rows.find((r) => r.userId === userId);
    if (!row) return;
    // Show the current quota in GB with at most one decimal (the amount is typed that way).
    setDraft(String(Math.round((row.quotaBytes / GB) * 10) / 10));
    setSaveError(null);
    setEditingId(userId);
  }
  function cancel() {
    setEditingId(null);
    setSaveError(null);
  }
  async function save() {
    const gb = parseGb(draft);
    if (editingId === null || gb === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateUser(editingId, { quotaBytes: Math.round(gb * GB) });
      setEditingId(null);
      await query.refetch();
    } catch (e) {
      setSaveError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return {
    rows,
    loading: query.isLoading,
    error: query.isError ? message(query.error) : null,
    retry: () => void query.refetch(),
    editingId, draft, setDraft, saving, saveError, canSave,
    startEdit, cancel, save,
  };
}

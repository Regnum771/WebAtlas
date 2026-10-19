import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GROUP_TEMPLATES, COUNTRY_UNIT, type Permission, type UnitNode } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { useUnitTree } from '../../../entities/session/model/useUnitTree';
import { listGroups, createGroup, updateGroup, deleteGroup, type AccessGroup } from '../api/accessGroups.api';

export type TemplateChoice = 'blank' | (typeof GROUP_TEMPLATES)[number]['id'];

export interface GroupFormValues {
  name: string;
  description: string;
  units: string[];
  permissions: Permission[];
}

type ModalState = { mode: 'closed' | 'create' | 'edit'; group: AccessGroup | null };
const EMPTY: GroupFormValues = { name: '', description: '', units: [], permissions: [] };

function mapError(e: unknown): { fields: Record<string, string>; form: string | null } {
  if (e instanceof ApiError) {
    if (e.status === 409) return { fields: { name: 'Đã có nhóm tên này.' }, form: null };
    if (e.status === 400) {
      const raw = (e.details as { fieldErrors?: unknown } | null | undefined)?.fieldErrors;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(v) && v.length > 0) fields[k] = v.join(', ');
        }
        if (Object.keys(fields).length > 0) return { fields, form: null };
      }
      // The server sends details.units for codes missing from the tree.
      const d = e.details as { units?: unknown } | null | undefined;
      if (d && typeof d === 'object' && 'units' in d) return { fields: { units: e.message }, form: null };
      return { fields: {}, form: e.message };
    }
    if (e.status === 403) return { fields: {}, form: 'Bạn không có quyền làm việc này.' };
    return { fields: {}, form: e.message };
  }
  return { fields: {}, form: e instanceof Error ? e.message : 'Chưa lưu được. Thử lại.' };
}

export function useGroupsPresenter() {
  const qc = useQueryClient();
  const tree = useUnitTree();
  const query = useQuery({ queryKey: ['access-groups'], queryFn: listGroups });

  const [modal, setModal] = useState<ModalState>({ mode: 'closed', group: null });
  const [values, setValues] = useState<GroupFormValues>(EMPTY);
  const [template, setTemplate] = useState<TemplateChoice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AccessGroup | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['access-groups'] });
  const saveMut = useMutation({
    mutationFn: (v: { id: string | null; input: Parameters<typeof createGroup>[0] }) =>
      v.id ? updateGroup(v.id, v.input) : createGroup(v.input),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({ mutationFn: deleteGroup, onSuccess: invalidate });

  const resetErrors = () => { setFieldErrors({}); setFormError(null); };

  const openCreate = () => { setValues(EMPTY); setTemplate(null); resetErrors(); setModal({ mode: 'create', group: null }); };
  const openEdit = (group: AccessGroup) => {
    setValues({ name: group.name, description: group.description ?? '', units: [...group.units], permissions: [...group.permissions] });
    setTemplate(null); resetErrors(); setModal({ mode: 'edit', group });
  };
  const closeModal = () => setModal({ mode: 'closed', group: null });

  const chooseTemplate = (choice: TemplateChoice) => {
    setTemplate(choice);
    if (choice === 'blank') { setValues(EMPTY); return; }
    const t = GROUP_TEMPLATES.find((x) => x.id === choice)!;
    setValues((prev) => ({
      ...prev, name: t.name, permissions: [...t.permissions],
      units: t.level === 'country' ? [COUNTRY_UNIT] : [],
    }));
  };

  const setField = (k: 'name' | 'description', v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const setUnits = (units: string[]) => setValues((prev) => ({ ...prev, units }));
  const togglePermission = (p: Permission) => setValues((prev) => ({
    ...prev,
    permissions: prev.permissions.includes(p) ? prev.permissions.filter((x) => x !== p) : [...prev.permissions, p],
  }));

  const canSave = values.name.trim() !== '' && values.units.length > 0 && values.permissions.length > 0;

  const submit = async () => {
    resetErrors();
    const input = {
      name: values.name.trim(),
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      units: values.units, permissions: values.permissions,
    };
    try {
      await saveMut.mutateAsync({ id: modal.mode === 'edit' && modal.group ? modal.group.id : null, input });
      closeModal();
    } catch (e) {
      const m = mapError(e);
      setFieldErrors(m.fields); setFormError(m.form);
    }
  };

  const askDelete = (group: AccessGroup) => { setDeleteError(null); setPendingDelete(group); };
  const cancelDelete = () => setPendingDelete(null);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(mapError(e).form ?? 'Chưa xoá được. Thử lại.');
    }
  };

  const level: UnitNode['level'] | null = template && template !== 'blank'
    ? GROUP_TEMPLATES.find((t) => t.id === template)!.level : null;

  return {
    groups: query.data ?? [],
    loading: query.isLoading,
    listError: query.isError ? 'Không tải được danh sách nhóm quyền.' : null,
    retry: () => { void query.refetch(); },
    tree, modal, values, template, pickerLevel: level, fieldErrors, formError,
    saving: saveMut.isPending, canSave,
    openCreate, openEdit, closeModal, chooseTemplate, setField, setUnits, togglePermission, submit,
    pendingDelete, deleteError, deleting: deleteMut.isPending,
    deleteMessage: pendingDelete
      ? `Xoá nhóm ${pendingDelete.name}? ${pendingDelete.memberCount} người sẽ mất các quyền của nhóm này.` : '',
    askDelete, cancelDelete, confirmDelete,
  };
}

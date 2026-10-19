import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '../../../shared/api/queryClient';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';
import type { Role } from '../../../entities/session/model/session.types';
import type { Grant } from '@webatlas/shared';
import { useUnitTree } from '../../../entities/session/model/useUnitTree';
import { showToast } from '../../../shared/ui/toast.store';
import { listGroups, type AccessGroup } from '../../access-groups/api/accessGroups.api';
import { listUsers, createUser, updateUser, setUserGroups, type AdminUser } from '../api/users.api';
import { jurisdictionSummary } from './jurisdictionSummary';
import { canHandOver } from './canHandOver';

type ModalState = { mode: 'closed' | 'create' | 'edit'; user: AdminUser | null };
interface FormValues { email: string; password: string; full_name: string; role: Role; }
const EMPTY: FormValues = { email: '', password: '', full_name: '', role: 'viewer' };

function mapError(e: unknown, setFieldErrors: (f: Record<string, string>) => void, setFormError: (s: string) => void) {
  if (e instanceof ApiError) {
    if (e.status === 409) { setFieldErrors({ email: 'Email này đã có người dùng.' }); return; }
    if (e.status === 400) {
      const details = e.details as { formErrors?: unknown; fieldErrors?: unknown } | null | undefined;
      const rawFieldErrors = details?.fieldErrors;
      if (rawFieldErrors && typeof rawFieldErrors === 'object' && !Array.isArray(rawFieldErrors)) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawFieldErrors as Record<string, unknown>)) {
          if (Array.isArray(v)) fe[k] = v.join(', ');
        }
        if (Object.keys(fe).length > 0) { setFieldErrors(fe); return; }
      }
      const formErrors = details?.formErrors;
      if (Array.isArray(formErrors) && formErrors.length > 0) { setFormError(formErrors.join(', ')); return; }
      setFormError(e.message); return;
    }
    if (e.status === 403) { setFormError('Bạn không có quyền làm việc này.'); return; }
    setFormError(e.message); return;
  }
  setFormError(e instanceof Error ? e.message : 'Chưa lưu được. Thử lại.');
}

export function useUsersPresenter() {
  const { currentUser } = useSession();
  const query = useQuery({ queryKey: ['users'], queryFn: listUsers });
  // Same key as the access-groups feature, so the cache is shared.
  const groupsQuery = useQuery({ queryKey: ['access-groups'], queryFn: listGroups });
  const tree = useUnitTree();
  const adminActions = currentUser?.isAdmin === true;
  const groups: AccessGroup[] = groupsQuery.data ?? [];
  const groupsLoading = groupsQuery.isLoading;
  const groupsError = groupsQuery.isError;
  const [groupsDialog, setGroupsDialog] = useState<{ user: AdminUser | null; selected: string[]; error: string | null }>(
    { user: null, selected: [], error: null },
  );

  const [modal, setModal] = useState<ModalState>({ mode: 'closed', user: null });
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const createMut = useMutation({ mutationFn: createUser, onSuccess: invalidate });
  const updateMut = useMutation({ mutationFn: (v: { id: string; patch: Parameters<typeof updateUser>[1] }) => updateUser(v.id, v.patch), onSuccess: invalidate });

  const openCreate = () => { setValues(EMPTY); setFieldErrors({}); setFormError(null); setModal({ mode: 'create', user: null }); };
  const openEdit = (user: AdminUser) => {
    setValues({ email: user.email, password: '', full_name: user.full_name ?? '', role: user.role });
    setFieldErrors({}); setFormError(null); setModal({ mode: 'edit', user });
  };
  const closeModal = () => setModal({ mode: 'closed', user: null });
  const setField = (k: keyof FormValues, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  // A user's grants come from expanding their groups against the group list already loaded.
  const summaryFor = (user: AdminUser): string[] => {
    if (user.role === 'admin') return ['Quản trị viên — toàn quyền'];
    if (groupsLoading) return ['Đang tải…'];
    if (groupsError) return ['Không tải được nhóm'];
    const grants: Grant[] = [];
    for (const m of user.groups) {
      const g = groups.find((x) => x.id === m.id);
      if (g) for (const unit of g.units) for (const permission of g.permissions) grants.push({ permission, unit });
    }
    return jurisdictionSummary(grants, tree);
  };

  const canHandOverGroup = (g: AccessGroup) =>
    canHandOver({ isAdmin: adminActions, grants: currentUser?.grants ?? [] }, g, tree);

  const openGroups = (user: AdminUser) => setGroupsDialog({ user, selected: user.groups.map((g) => g.id), error: null });
  const closeGroups = () => setGroupsDialog({ user: null, selected: [], error: null });
  const toggleGroup = (id: string) => setGroupsDialog((d) => ({
    ...d, selected: d.selected.includes(id) ? d.selected.filter((x) => x !== id) : [...d.selected, id],
  }));
  const groupsMut = useMutation({
    mutationFn: (v: { id: string; groupIds: string[] }) => setUserGroups(v.id, v.groupIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-groups'] });
      return invalidate();
    },
  });
  const submitGroups = async () => {
    const { user, selected } = groupsDialog;
    if (!user) return;
    setGroupsDialog((d) => ({ ...d, error: null }));
    try {
      await groupsMut.mutateAsync({ id: user.id, groupIds: selected });
      showToast({ tone: 'success', title: `Đã lưu nhóm của ${user.email}.` });
      closeGroups();
    } catch (e) {
      const message = e instanceof ApiError && e.status === 403 && e.code === 'ESCALATION'
        ? e.message : 'Chưa lưu được nhóm. Thử lại.';
      setGroupsDialog((d) => ({ ...d, error: message }));
    }
  };

  const canModify = (user: AdminUser) => user.id !== currentUser?.id;

  const canSave =
    modal.mode === 'edit' ||
    (modal.mode === 'create' && /\S+@\S+\.\S+/.test(values.email) && values.password.length >= 8);

  const submitForm = async () => {
    setFieldErrors({}); setFormError(null);
    try {
      if (modal.mode === 'create') {
        await createMut.mutateAsync({
          email: values.email, password: values.password,
          full_name: values.full_name || undefined, role: values.role,
        });
      } else if (modal.mode === 'edit' && modal.user) {
        await updateMut.mutateAsync({ id: modal.user.id, patch: { full_name: values.full_name || null, role: values.role } });
      }
      closeModal();
    } catch (e) {
      mapError(e, setFieldErrors, setFormError);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    try {
      await updateMut.mutateAsync({ id: user.id, patch: { is_active: !user.is_active } });
    } catch (e) {
      mapError(e, () => {}, setFormError);
    }
  };

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    listError: query.error ? 'Không tải được danh sách người dùng.' : null,
    modal, values, fieldErrors, formError,
    saving: createMut.isPending || updateMut.isPending,
    retry: () => { void query.refetch(); },
    groupsLoading, groupsError, retryGroups: () => { void groupsQuery.refetch(); },
    adminActions, groups, tree, groupsDialog, groupsSaving: groupsMut.isPending,
    summaryFor, canHandOverGroup, openGroups, closeGroups, toggleGroup, submitGroups,
    canSave, canModify,
    openCreate, openEdit, closeModal, setField, submitForm, toggleActive,
  };
}

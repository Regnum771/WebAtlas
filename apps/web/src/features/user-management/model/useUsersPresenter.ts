import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '../../../shared/api/queryClient';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';
import type { Role } from '../../../entities/session/model/session.types';
import { listUsers, createUser, updateUser, type AdminUser } from '../api/users.api';

type ModalState = { mode: 'closed' | 'create' | 'edit'; user: AdminUser | null };
interface FormValues { email: string; password: string; full_name: string; role: Role; }
const EMPTY: FormValues = { email: '', password: '', full_name: '', role: 'viewer' };

function mapError(e: unknown, setFieldErrors: (f: Record<string, string>) => void, setFormError: (s: string) => void) {
  if (e instanceof ApiError) {
    if (e.status === 409) { setFieldErrors({ email: 'Email already in use' }); return; }
    if (e.status === 400 && e.details && typeof e.details === 'object') {
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.details as Record<string, unknown>)) {
        fe[k] = Array.isArray(v) ? String(v[0]) : String(v);
      }
      setFieldErrors(fe); return;
    }
    if (e.status === 403) { setFormError('You do not have permission'); return; }
    setFormError(e.message); return;
  }
  setFormError(e instanceof Error ? e.message : 'Something went wrong');
}

export function useUsersPresenter() {
  const { currentUser } = useSession();
  const query = useQuery({ queryKey: ['users'], queryFn: listUsers });

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
    listError: query.error ? "Couldn't load users" : null,
    modal, values, fieldErrors, formError,
    saving: createMut.isPending || updateMut.isPending,
    canSave, canModify,
    openCreate, openEdit, closeModal, setField, submitForm, toggleActive,
  };
}

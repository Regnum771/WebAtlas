import { Modal } from '../../../shared/ui/Modal';
import type { Role } from '../../../entities/session/model/session.types';

interface Values { email: string; password: string; full_name: string; role: Role; }

export function UserFormModalView({ open, mode, values, fieldErrors, formError, canSave, saving, onField, onSubmit, onClose }: {
  open: boolean;
  mode: 'create' | 'edit';
  values: Values;
  fieldErrors: Record<string, string>;
  formError: string | null;
  canSave: boolean;
  saving: boolean;
  onField: (k: keyof Values, v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="user-form">
        <h3>{mode === 'create' ? 'New user' : 'Edit user'}</h3>

        <label htmlFor="uf-email">Email</label>
        <input
          id="uf-email" type="email" value={values.email}
          readOnly={mode === 'edit'}
          onChange={(e) => onField('email', e.target.value)}
        />
        {fieldErrors.email && <p className="field-error" role="alert">{fieldErrors.email}</p>}

        {mode === 'create' && (
          <>
            <label htmlFor="uf-password">Password</label>
            <input id="uf-password" type="password" value={values.password} onChange={(e) => onField('password', e.target.value)} />
            {fieldErrors.password && <p className="field-error" role="alert">{fieldErrors.password}</p>}
          </>
        )}

        <label htmlFor="uf-name">Full name</label>
        <input id="uf-name" type="text" value={values.full_name} onChange={(e) => onField('full_name', e.target.value)} />

        <label htmlFor="uf-role">Role</label>
        <select id="uf-role" value={values.role} onChange={(e) => onField('role', e.target.value)}>
          <option value="admin">admin</option>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>

        {formError && <p className="form-error" role="alert">{formError}</p>}

        <div className="user-form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSave || saving}>{mode === 'create' ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';
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
    <Dialog open={open} title={mode === 'create' ? 'Thêm người dùng' : 'Sửa người dùng'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="user-form">
        <TextField
          id="uf-email" label="Email" type="email" value={values.email}
          readOnly={mode === 'edit'} error={fieldErrors.email}
          onChange={(e) => onField('email', e.target.value)}
        />

        {mode === 'create' && (
          <TextField
            id="uf-password" label="Mật khẩu" type="password" value={values.password}
            error={fieldErrors.password}
            onChange={(e) => onField('password', e.target.value)}
          />
        )}

        <TextField
          id="uf-name" label="Họ tên" type="text" value={values.full_name}
          error={fieldErrors.full_name}
          onChange={(e) => onField('full_name', e.target.value)}
        />

        <div className="field">
          <label htmlFor="uf-role">Vai trò</label>
          <select id="uf-role" className="input" value={values.role} onChange={(e) => onField('role', e.target.value)}>
            <option value="admin">{ROLE_LABELS.admin}</option>
            <option value="viewer">{ROLE_LABELS.viewer}</option>
          </select>
        </div>

        {formError && <Message tone="error" title={formError} />}

        <div className="user-form-actions">
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={saving} disabled={!canSave && !saving}>
            {mode === 'create' ? 'Tạo' : 'Lưu'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

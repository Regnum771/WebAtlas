import type { ReactNode } from 'react';
import { GROUP_TEMPLATES, PERMISSIONS, PERMISSION_LABELS, type Permission } from '@webatlas/shared';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import type { GroupFormValues, TemplateChoice } from '../model/useGroupsPresenter';

export function GroupFormView({ open, mode, values, template, fieldErrors, formError, canSave, saving, picker,
  onTemplate, onField, onTogglePermission, onSubmit, onClose }: {
  open: boolean;
  mode: 'create' | 'edit';
  values: GroupFormValues;
  template: TemplateChoice | null;
  fieldErrors: Record<string, string>;
  formError: string | null;
  canSave: boolean;
  saving: boolean;
  /** The unit picker, rendered by the caller so this view stays dumb. */
  picker: ReactNode;
  onTemplate: (t: TemplateChoice) => void;
  onField: (k: 'name' | 'description', v: string) => void;
  onTogglePermission: (p: Permission) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const choices: Array<{ id: TemplateChoice; label: string }> = [
    ...GROUP_TEMPLATES.map((t) => ({ id: t.id as TemplateChoice, label: t.name })),
    { id: 'blank', label: 'Trống' },
  ];
  return (
    <Dialog open={open} title={mode === 'create' ? 'Tạo nhóm' : 'Sửa nhóm'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="user-form group-form">
        {mode === 'create' && (
          <fieldset className="group-form-set">
            <legend>Từ mẫu</legend>
            {choices.map((c) => (
              <label key={c.id}>
                <input type="radio" name="group-template" checked={template === c.id} onChange={() => onTemplate(c.id)} />
                {' '}{c.label}
              </label>
            ))}
          </fieldset>
        )}

        {picker}

        <fieldset className="group-form-set">
          <legend>Quyền</legend>
          {PERMISSIONS.map((p) => (
            <label key={p}>
              <input type="checkbox" checked={values.permissions.includes(p)} onChange={() => onTogglePermission(p)} />
              {' '}{PERMISSION_LABELS[p]}
            </label>
          ))}
          {fieldErrors.permissions && <p className="hint bad" role="alert">{fieldErrors.permissions}</p>}
        </fieldset>

        <TextField id="gf-name" label="Tên nhóm" value={values.name} error={fieldErrors.name}
          onChange={(e) => onField('name', e.target.value)} />
        <TextField id="gf-desc" label="Mô tả" value={values.description} error={fieldErrors.description}
          onChange={(e) => onField('description', e.target.value)} />

        {formError && <Message tone="error" title={formError} />}

        <div className="user-form-actions">
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={saving} disabled={!canSave && !saving}>Lưu</Button>
        </div>
      </form>
    </Dialog>
  );
}

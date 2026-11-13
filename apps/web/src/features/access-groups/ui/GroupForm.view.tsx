import type { ReactNode } from 'react';
import { GROUP_TEMPLATES, PERMISSIONS, PERMISSION_LABELS, type Permission } from '@webatlas/shared';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import type { GroupFormValues, TemplateChoice } from '../model/useGroupsPresenter';
import { ui } from '../../../shared/ui/styles';

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
      <form data-slot="group-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className={ui.form}>
        {mode === 'create' && (
          <fieldset className={ui.fieldset}>
            <legend className={ui.legend}>Từ mẫu</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {choices.map((c) => (
                <label key={c.id} className={ui.check}>
                  <input type="radio" name="group-template" checked={template === c.id} onChange={() => onTemplate(c.id)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {picker}

        <fieldset className={ui.fieldset}>
          <legend className={ui.legend}>Quyền</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-1.5">
            {PERMISSIONS.map((p) => (
              <label key={p} className={ui.check}>
                <input type="checkbox" checked={values.permissions.includes(p)} onChange={() => onTogglePermission(p)} />
                <span>{PERMISSION_LABELS[p]}</span>
              </label>
            ))}
          </div>
          {fieldErrors.permissions && <p className={ui.fieldError} role="alert">{fieldErrors.permissions}</p>}
        </fieldset>

        <TextField id="gf-name" label="Tên nhóm" value={values.name} error={fieldErrors.name}
          onChange={(e) => onField('name', e.target.value)} />
        <TextField id="gf-desc" label="Mô tả" value={values.description} error={fieldErrors.description}
          onChange={(e) => onField('description', e.target.value)} />

        {formError && <Message tone="error" title={formError} />}

        <div className={ui.formActions}>
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={saving} disabled={!canSave && !saving}>Lưu</Button>
        </div>
      </form>
    </Dialog>
  );
}

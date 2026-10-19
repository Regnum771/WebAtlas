import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { useManagingUnitField } from '../../feature-editing/model/useManagingUnitField';
import { ManagingUnitFieldView } from '../../feature-editing/ui/ManagingUnitField.view';
import type { UnassignedFeature } from '../api/unassigned.api';

/** Mounted per target, so the field starts empty each time it opens. */
export function AssignDialog({ target, saving, error, errorDetail = null, onSave, onClose }: {
  target: UnassignedFeature;
  saving: boolean;
  error: string | null;
  /** A second line under the error, e.g. the missing review right of a refusal. */
  errorDetail?: string | null;
  onSave: (unit: string) => void;
  onClose: () => void;
}) {
  // Assigning is an update (PUT): units need feature.update and submission.review.
  const field = useManagingUnitField({ layerKey: target.layerKey, mode: 'edit', geometry: null, initial: '' });
  return (
    <Dialog open title="Gán đơn vị chủ quản" onClose={onClose}>
      <p>{target.name ?? '(không tên)'}</p>
      <ManagingUnitFieldView field={field} />
      {error && <Message tone="error" title={error}>{errorDetail}</Message>}
      <div className="edit-form-actions">
        <Button variant="solid" busy={saving} busyLabel="Đang lưu" disabled={!field.submittable && !saving}
          onClick={() => { if (field.submittable) onSave(field.submittable); }}>Lưu</Button>
        <Button onClick={onClose}>Huỷ</Button>
      </div>
    </Dialog>
  );
}

import { useUnassignedPresenter } from './model/useUnassignedPresenter';
import { UnassignedView } from './ui/Unassigned.view';
import { AssignDialog } from './ui/AssignDialog';

// UX gate lives in the Quản lý layout; the API enforces jurisdiction on the assigning save.
export function UnassignedPanel() {
  const p = useUnassignedPresenter();
  return (
    <UnassignedView
      rows={p.rows} loading={p.loading} failed={p.failed} onRetry={p.retry} onAssign={p.open}
      dialog={p.target && (
        <AssignDialog key={`${p.target.layerKey}:${p.target.id}`} target={p.target} saving={p.saving}
          error={p.saveError} onSave={(unit) => { void p.assign(unit); }} onClose={p.close} />
      )}
    />
  );
}

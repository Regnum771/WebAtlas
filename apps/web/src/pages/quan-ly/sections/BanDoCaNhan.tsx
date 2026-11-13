import { UsageTableView } from '../../../features/my-maps/ui/UsageTable.view';
import { useUsagePresenter } from '../../../features/my-maps/model/useUsagePresenter';
import { ui } from '../../../shared/ui/styles';

// UX gate lives in the Quản lý layout; the API enforces admin on /api/workspace/admin/summary.
export default function BanDoCaNhan() {
  const p = useUsagePresenter();
  return (
    <section data-slot="admin-section" aria-labelledby="ban-do-ca-nhan" className={ui.section}>
      <h2 id="ban-do-ca-nhan" className={ui.title}>Bản đồ cá nhân</h2>
      <p className={ui.hint}>Quản trị viên chỉ thấy số lượng và dung lượng, không thấy nội dung bản đồ.</p>
      <UsageTableView
        rows={p.rows} loading={p.loading} error={p.error} onRetry={p.retry}
        editingId={p.editingId} draft={p.draft} saving={p.saving} saveError={p.saveError} canSave={p.canSave}
        onStartEdit={p.startEdit} onDraft={p.setDraft} onSave={p.save} onCancel={p.cancel}
      />
    </section>
  );
}

import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Pencil, X } from 'lucide-react';
import type { DisplayRow } from '../model/useDisplayPanelPresenter';

export function DisplayPanelView({
  title, layerLabel, rows, collapsed, canEdit,
  onToggleCollapse, onEdit, onClose, children,
}: {
  title: string;
  layerLabel: string;
  rows: DisplayRow[];
  collapsed: boolean;
  canEdit: boolean;
  onToggleCollapse: () => void;
  onEdit: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {/* The round button straddles the seam between drawer and panel. It exists only
          while something is selected — it toggles a panel, it is never a lone control. */}
      <button
        type="button"
        className="display-panel-toggle glass-panel"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>

      {!collapsed && (
        <aside className="display-panel glass-panel" aria-label="Chi tiết đối tượng">
          <header className="display-panel-header">
            <div>
              <h2>{title}</h2>
              <span className="display-panel-tag">{layerLabel}</span>
            </div>
            <div className="display-panel-actions">
              {canEdit && (
                <button type="button" onClick={onEdit} aria-label="Chỉnh sửa">
                  <Pencil size={16} />
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Đóng">
                <X size={16} />
              </button>
            </div>
          </header>
          <div className="display-panel-body">
            {children ?? (
              <dl className="display-panel-rows">
                {rows.map((r) => (
                  <div key={r.label} className="display-panel-row">
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

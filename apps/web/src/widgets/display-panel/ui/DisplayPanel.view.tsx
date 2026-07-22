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

      {/* Stays MOUNTED when collapsed — only visually/AT hidden via the `hidden`
          attribute. Unmounting here would drop EditForm's in-progress input state
          (useAttributeFormPresenter's useState) and, worse, would leave the map's
          ModifyController armed with no visible edit surface to cancel it from.
          `hidden` removes the subtree from the accessibility tree and from the tab
          order, so a folded panel is never reachable by keyboard or screen reader. */}
      <aside
        className="display-panel glass-panel"
        aria-label="Chi tiết đối tượng"
        hidden={collapsed}
      >
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
                <div key={r.iso} className="display-panel-row">
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </aside>
    </>
  );
}

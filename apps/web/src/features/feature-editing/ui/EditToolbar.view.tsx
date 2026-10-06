import type { ReactNode } from 'react';

// Passive toolbar shell.
export function EditToolbarView({ children }: { children: ReactNode }) {
  return (
    <div className="edit-toolbar">
      <h3 className="edit-toolbar-title">Thêm đối tượng</h3>
      {children}
    </div>
  );
}

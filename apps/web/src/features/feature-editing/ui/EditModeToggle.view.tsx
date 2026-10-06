import { Button } from '../../../shared/ui/Button';

export interface EditModeToggleViewProps {
  editMode: boolean;
  onEnter: () => void;
  onExit: () => void;
  hint: string;
}

// Passive: toggles the edit-existing mode.
export function EditModeToggleView({ editMode, onEnter, onExit, hint }: EditModeToggleViewProps) {
  return (
    <div className="edit-mode-toggle">
      {editMode ? (
        <>
          <Button onClick={onExit}>Thoát sửa</Button>
          {hint && <p className="edit-hint">{hint}</p>}
        </>
      ) : (
        <Button onClick={onEnter}>Sửa đối tượng có sẵn</Button>
      )}
    </div>
  );
}

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
          <button type="button" onClick={onExit}>Exit edit</button>
          {hint && <p className="edit-hint">{hint}</p>}
        </>
      ) : (
        <button type="button" onClick={onEnter}>Edit existing</button>
      )}
    </div>
  );
}

import { DictionaryEditorView, DictionaryHistoryView, useDictionaryEditorPresenter } from '../../../features/dictionary';

// UX gate lives in the Quản lý layout; the API enforces dictionary.manage on VN on every call.
export default function TuDien() {
  const p = useDictionaryEditorPresenter();
  return (
    <div className="user-mgmt-panel dictionary-editor-panel">
      <h2>Từ điển dữ liệu</h2>
      <p className="hint">Sửa tên, định nghĩa và đơn vị hiển thị của các lớp. Các trường theo cấu trúc dữ liệu không sửa được.</p>
      <DictionaryEditorView {...p.editor} />
      <DictionaryHistoryView {...p.history} />
    </div>
  );
}

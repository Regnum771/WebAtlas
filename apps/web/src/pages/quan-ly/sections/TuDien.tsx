import { DictionaryEditorView, DictionaryHistoryView, useDictionaryEditorPresenter } from '../../../features/dictionary';
import { ui } from '../../../shared/ui/styles';

// UX gate lives in the Quản lý layout; the API enforces dictionary.manage on VN on every call.
export default function TuDien() {
  const p = useDictionaryEditorPresenter();
  return (
    <section data-slot="admin-section" aria-labelledby="tu-dien" className={ui.section}>
      <h2 id="tu-dien" className={ui.title}>Từ điển dữ liệu</h2>
      <p className={ui.hint}>Sửa tên, định nghĩa và đơn vị hiển thị của các lớp. Các trường theo cấu trúc dữ liệu không sửa được.</p>
      <DictionaryEditorView {...p.editor} />
      <DictionaryHistoryView {...p.history} />
    </section>
  );
}

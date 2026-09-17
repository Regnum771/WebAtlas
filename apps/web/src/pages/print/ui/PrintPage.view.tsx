import type { ReactNode } from 'react';
import { PAPER_SIZES, type PaperId, type PrintToggles } from '../model/usePrintPage';

export interface PrintPageViewProps {
  title: string; onTitle: (v: string) => void;
  paper: PaperId; onPaper: (p: PaperId) => void;
  toggles: PrintToggles; onToggle: (k: keyof PrintToggles) => void;
  imageUrl: string | null; capturing: boolean; exportError: string | null;
  attributions: string[]; scaleText: string; crsLabel: string; date: string;
  legend: ReactNode; analysis: ReactNode;
  onDownload: () => void; onPrint: () => void; onClose: () => void;
}

// "Hiển thị …" (Show …), không phải danh từ trần: đây là hàng checkbox luôn hiện
// dù đang tắt (để bật lại được), khác với dòng dữ liệu tương ứng trên tấm in —
// cách viết đầy đủ câu tránh trùng nguyên văn với dòng đó (ví dụ "Tỷ lệ (theo
// màn hình): …"), nếu không truy vấn văn bản trong bài kiểm thử sẽ khớp nhầm
// vào đây khi ta chỉ muốn kiểm tra dòng đó đã ẩn.
const TOGGLE_LABELS: Record<keyof PrintToggles, string> = {
  legend: 'Hiển thị chú giải', scale: 'Hiển thị tỷ lệ', north: 'Hiển thị mũi tên chỉ hướng Bắc',
  date: 'Hiển thị ngày in', crs: 'Hiển thị hệ quy chiếu',
};

function NorthArrow() {
  return (
    <svg className="print-north" viewBox="0 0 24 36" width="24" height="36" role="img" aria-label="Hướng Bắc">
      <polygon points="12,0 22,24 12,18 2,24" fill="#111827" />
      <text x="12" y="35" textAnchor="middle" fontSize="10">B</text>
    </svg>
  );
}

export function PrintPageView(p: PrintPageViewProps) {
  return (
    <div className="print-route">
      <style>{`@page { size: ${PAPER_SIZES[p.paper].css}; margin: 10mm; }`}</style>
      <aside className="print-controls glass-panel" aria-label="Tuỳ chọn in">
        <h2 className="panel-title">In / Xuất bản đồ</h2>
        <label htmlFor="print-title">Tiêu đề</label>
        {/* maxLength=120 keeps the title within ~2 wrapped lines on the sheet
            at any paper width/size (see .print-title in main.css) — without
            it, an arbitrarily long title can grow tall enough to squeeze
            .print-content's other blocks (map/meta/legend/analysis). It
            cannot reach .print-attribution: that footer is now a separate,
            unconditionally-sized grid row on .print-sheet, not a sibling in
            this flex column — see .print-sheet's and .print-attribution's
            comments in main.css (the licence footer must always print). */}
        <input id="print-title" type="text" maxLength={120} value={p.title} onChange={(e) => p.onTitle(e.target.value)} />
        <label htmlFor="print-paper">Khổ giấy</label>
        <select id="print-paper" value={p.paper} onChange={(e) => p.onPaper(e.target.value as PaperId)}>
          {(Object.keys(PAPER_SIZES) as PaperId[]).map((id) => <option key={id} value={id}>{PAPER_SIZES[id].label}</option>)}
        </select>
        {(Object.keys(TOGGLE_LABELS) as (keyof PrintToggles)[]).map((k) => (
          <label key={k} className="print-toggle">
            <input type="checkbox" checked={p.toggles[k]} onChange={() => p.onToggle(k)} /> {TOGGLE_LABELS[k]}
          </label>
        ))}
        {p.exportError && <p className="edit-form-error" role="alert">{p.exportError}</p>}
        <div className="analysis-actions">
          <button type="button" onClick={p.onDownload} disabled={!p.imageUrl}>Tải PNG</button>
          <button type="button" onClick={p.onPrint} disabled={!p.imageUrl}>In / PDF</button>
          <button type="button" onClick={p.onClose}>Đóng</button>
        </div>
      </aside>

      <article className={`print-sheet print-${p.paper}`}>
        {/* .print-content is the sheet's ONE flexible grid row — see
            .print-sheet's comment in main.css. Wrapping title/map/meta/body
            here (instead of leaving them as direct .print-sheet children,
            as before) is what makes .print-attribution below a structurally
            separate, always-fully-sized sibling rather than a fifth
            competitor in the same shrink-or-clip flex column. */}
        <div className="print-content">
          <h1 className="print-title">{p.title}</h1>
          <div className="print-map">
            {p.capturing && !p.imageUrl && <p className="analysis-note">Đang chụp bản đồ…</p>}
            {p.imageUrl && <img src={p.imageUrl} alt="Bản đồ in" />}
            {p.toggles.north && <NorthArrow />}
          </div>
          <div className="print-meta">
            {p.toggles.scale && <span>Tỷ lệ (theo màn hình): {p.scaleText}</span>}
            {p.toggles.crs && <span>Hệ quy chiếu: {p.crsLabel}</span>}
            {p.toggles.date && <span>Ngày in: {p.date}</span>}
          </div>
          <div className="print-body">
            {p.toggles.legend && <div className="print-legend">{p.legend}</div>}
            {p.analysis && <div className="print-analysis">{p.analysis}</div>}
          </div>
        </div>
        <footer className="print-attribution">
          {p.attributions.map((a) => <p key={a}>{a}</p>)}
        </footer>
      </article>
    </div>
  );
}

import type { FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import type { CatalogueItem, CatalogueKind } from '../api/catalogue.api';
import type { PickerStatus } from '../model/useCataloguePickerPresenter';

export interface CataloguePickerViewProps {
  query: string;
  kind: CatalogueKind | '';
  status: PickerStatus;
  items: CatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  addedIds: Set<string>;
  /** Signed in: the time-series upload is offered. */
  canUpload: boolean;
  onQuery: (q: string) => void;
  onKind: (k: CatalogueKind | '') => void;
  onSearch: () => void;
  onPage: (page: number) => void;
  onAdd: (item: CatalogueItem) => void;
  onUpload: () => void;
}

const KIND_LABEL: Record<CatalogueKind, string> = {
  vector: 'Vector', raster: 'Raster', timeseries: 'Chuỗi thời gian', map: 'Bản đồ', document: 'Tài liệu',
};
/** Kinds that have a WMS to draw; maps and documents are only listed. */
const DRAWABLE: CatalogueKind[] = ['vector', 'raster', 'timeseries'];

/** Passive: search box, kind filter, result list with Thêm vào bản đồ, paging. */
export function CataloguePickerView(p: CataloguePickerViewProps) {
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    p.onSearch();
  };
  return (
    <div className="tool-section catalogue-picker">
      <form className="catalogue-search" onSubmit={onSubmit} role="search">
        <input
          className="input"
          type="search"
          aria-label="Tìm trong Danh mục"
          placeholder="Tìm theo tên hoặc mô tả"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
        <select className="input" aria-label="Loại dữ liệu" value={p.kind} onChange={(e) => p.onKind(e.target.value as CatalogueKind | '')}>
          <option value="">Mọi loại</option>
          {(Object.keys(KIND_LABEL) as CatalogueKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <Button type="submit" size="sm">Tìm</Button>
      </form>

      {p.status === 'loading' && <Spinner label="Đang tải Danh mục" />}
      {p.status === 'error' && <Message tone="error" title="Không kết nối được Danh mục." />}
      {p.status === 'ok' && p.items.length === 0 && <p className="hint">Không có dữ liệu phù hợp.</p>}

      {p.status === 'ok' && p.items.length > 0 && (
        <ul className="catalogue-results">
          {p.items.map((item) => (
            <li key={item.id} className="catalogue-result">
              <div className="catalogue-result-head">
                <b>{item.title}</b>
                {item.mine && !item.isPublished && <span className="badge">Chưa duyệt</span>}
              </div>
              <span className="hint">{[KIND_LABEL[item.kind], item.managingUnit].filter(Boolean).join(' · ')}</span>
              {DRAWABLE.includes(item.kind) && (
                p.addedIds.has(item.id)
                  ? <span className="hint">Đã thêm</span>
                  : <Button size="sm" aria-label={`Thêm vào bản đồ: ${item.title}`} onClick={() => p.onAdd(item)}>Thêm vào bản đồ</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.status === 'ok' && pages > 1 && (
        <div className="tool-buttons">
          <Button size="sm" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>Trước</Button>
          <span className="hint">{`Trang ${p.page}/${pages}`}</span>
          <Button size="sm" disabled={p.page >= pages} onClick={() => p.onPage(p.page + 1)}>Sau</Button>
        </div>
      )}

      {p.canUpload && (
        <div className="tool-buttons">
          <Button size="sm" onClick={p.onUpload}>Tải chuỗi thời gian lên</Button>
        </div>
      )}
    </div>
  );
}

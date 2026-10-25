import { Link } from 'react-router-dom';

export interface LayerPageRow {
  name: string;
  label: string;
  definition: string;
  /** chữ, số, ngày or mã. */
  typeLabel: string;
  /** Symbols, `stored → display` when they differ. */
  unitText?: string;
  /** Ready lines such as `1 triệu m³ = 1.000.000 m³`. */
  conversions: string[];
  values?: { code: string; name: string; retired: boolean }[];
  cfStandardName?: string;
  retired: boolean;
}

export interface LayerPageData {
  name: string;
  definition: string;
  kindLabel: string;
  /** Geometry type and what it stands for; vector layers only. */
  geometryText?: string;
  epsg: string;
  validFrom: string;
  /** Set when the layer is retired. */
  retiredFrom?: string;
  rows: LayerPageRow[];
  /** Absent for rasters and retired layers. */
  templates?: { gpkg: string; csv: string };
}

interface Props {
  /** Null when the key names no layer. */
  page: LayerPageData | null;
}

/** Passive: one layer's description, attribute table and template downloads. */
export function LayerPageView({ page }: Props) {
  if (!page) {
    return (
      <div className="quan-ly-section layer-page">
        <p>Không có lớp này trong từ điển dữ liệu.</p>
        <Link className="link" to="/du-lieu">Về danh sách</Link>
      </div>
    );
  }
  return (
    <div className="quan-ly-section layer-page">
      <header className="layer-page-head">
        <div className="layer-page-title">
          <h2>{page.name}</h2>
          <div className="layer-page-actions no-print">
            <Link className="link" to="/du-lieu">Về danh sách</Link>
            <button type="button" className="btn sm" onClick={() => window.print()}>In</button>
          </div>
        </div>
        <p className="layer-page-def">{page.definition}</p>
        <p className="layer-page-meta">
          <span>{page.kindLabel}</span>
          {page.geometryText && <span>{page.geometryText}</span>}
          <span>{page.epsg}</span>
          <span>{`Hiệu lực từ ${page.validFrom}`}</span>
        </p>
        {page.retiredFrom && <p className="layer-page-retired" role="status">{`Đã ngừng dùng từ ${page.retiredFrom}`}</p>}
        {page.templates && (
          <p className="layer-page-templates no-print">
            <a className="btn sm" href={page.templates.gpkg} download>Tải mẫu GeoPackage</a>
            <a className="btn sm" href={page.templates.csv} download>Tải mẫu CSV</a>
          </p>
        )}
      </header>
      <div className="layer-page-table-wrap">
        <table className="layer-page-table">
          <thead>
            <tr>
              <th scope="col">Thuộc tính</th>
              <th scope="col">Ý nghĩa</th>
              <th scope="col">Kiểu</th>
              <th scope="col">Đơn vị (lưu → hiển thị)</th>
              <th scope="col">Quy đổi thông dụng</th>
              <th scope="col">Giá trị</th>
              <th scope="col">Tên chuẩn CF</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.name} className={row.retired ? 'layer-page-row-retired' : undefined}>
                <th scope="row">
                  <span>{row.label}</span>
                  <code className="layer-page-attr">{row.name}</code>
                  {row.retired && <span className="layer-page-badge">ngừng dùng</span>}
                </th>
                <td>{row.definition}</td>
                <td>{row.typeLabel}</td>
                <td>{row.unitText ?? '—'}</td>
                <td>
                  {row.conversions.length === 0 ? '—' : (
                    <ul className="layer-page-list">
                      {row.conversions.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  )}
                </td>
                <td>
                  {row.values ? (
                    <details className="layer-page-values">
                      <summary>{`${row.values.length} giá trị`}</summary>
                      <ul className="layer-page-list">
                        {row.values.map((v) => (
                          <li key={v.code}>
                            <code>{v.code}</code> {v.name}
                            {v.retired && <span className="layer-page-badge">ngừng dùng</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : '—'}
                </td>
                <td>{row.cfStandardName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

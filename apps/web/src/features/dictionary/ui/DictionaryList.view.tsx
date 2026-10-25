import { Link } from 'react-router-dom';

export interface ListRow {
  key: string;
  name: string;
  definition: string;
}

export interface ListGroup {
  title: string;
  rows: ListRow[];
}

interface Props {
  query: string;
  onQuery: (query: string) => void;
  groups: ListGroup[];
  /** True when the search left nothing to show. */
  empty: boolean;
}

/** Passive: the dictionary's layers in two groups, with a search box. */
export function DictionaryListView({ query, onQuery, groups, empty }: Props) {
  return (
    <div className="quan-ly-section dictionary-list">
      <header className="dictionary-list-head">
        <h2>Dữ liệu</h2>
        <Link className="link" to="/">Về bản đồ</Link>
      </header>
      <input
        type="search"
        className="input"
        aria-label="Tìm lớp"
        placeholder="Tìm lớp"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {empty && <p className="dictionary-list-empty">Không có lớp nào khớp.</p>}
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="dictionary-list-group">
          <h3>{group.title}</h3>
          <ul className="dictionary-list-rows">
            {group.rows.map((row) => (
              <li key={row.key}>
                <Link className="dictionary-list-row" to={`/du-lieu/${row.key}`}>
                  <span className="dictionary-list-name">{row.name}</span>
                  <span className="dictionary-list-def">{row.definition}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

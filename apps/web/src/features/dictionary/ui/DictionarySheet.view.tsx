import { Link } from 'react-router-dom';

export interface SheetRow {
  name: string;
  label: string;
  /** Display-unit symbol, when the attribute has a unit. */
  unitSymbol?: string;
  definition: string;
  /** Number of current values, for code attributes. */
  valueCount?: number;
}

interface Props {
  title: string;
  dictionaryKey: string;
  rows: SheetRow[];
  onClose: () => void;
}

/** Passive: the quick attribute sheet beside the side panel. */
export function DictionarySheetView({ title, dictionaryKey, rows, onClose }: Props) {
  return (
    <section className="dictionary-sheet" role="region" aria-label={title}>
      <header className="dictionary-sheet-head">
        <h3 className="dictionary-sheet-title">{title}</h3>
        <button type="button" className="dictionary-sheet-close" onClick={onClose} autoFocus>
          Đóng
        </button>
      </header>
      <ul className="dictionary-sheet-list">
        {rows.map((row) => (
          <li key={row.name} className="dictionary-sheet-row">
            <div className="dictionary-sheet-label">
              <span>{row.label}</span>
              {row.unitSymbol && <span className="dictionary-sheet-unit">{row.unitSymbol}</span>}
            </div>
            <p className="dictionary-sheet-def">{row.definition}</p>
            {row.valueCount !== undefined && (
              <p className="dictionary-sheet-count">{row.valueCount} giá trị</p>
            )}
          </li>
        ))}
      </ul>
      <Link className="link" to={`/du-lieu/${dictionaryKey}`}>Xem đầy đủ →</Link>
    </section>
  );
}

import { useMemo, useState } from 'react';
import { useDictionary } from './useDictionary';
import { normalizeText } from '../../access-groups/model/useUnitPicker';
import type { ListGroup, ListRow } from '../ui/DictionaryList.view';

/** Same rule as the quick sheet: retired when the end date is not in the future. */
function isCurrent(validTo: string | undefined, today: string): boolean {
  return !validTo || validTo > today;
}

const GROUPS = [
  { kind: 'vector', title: 'Lớp vectơ' },
  { kind: 'raster', title: 'Lớp ảnh' },
] as const;

/** The /du-lieu list: current feature types by kind, filtered by an accent-insensitive search. */
export function useDictionaryListPresenter() {
  const dictionary = useDictionary();
  const [query, onQuery] = useState('');

  const { groups, empty } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const q = normalizeText(query.trim());
    const current = Object.values(dictionary).filter((f) => isCurrent(f.validTo, today));
    const out: ListGroup[] = [];
    for (const { kind, title } of GROUPS) {
      const rows: ListRow[] = current
        .filter((f) => f.kind === kind)
        .filter((f) => !q || normalizeText(`${f.name} ${f.definition}`).includes(q))
        .map((f) => ({ key: f.key, name: f.name, definition: f.definition }));
      if (rows.length > 0) out.push({ title, rows });
    }
    return { groups: out, empty: out.length === 0 };
  }, [dictionary, query]);

  return { query, onQuery, groups, empty };
}

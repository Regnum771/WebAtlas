import { useMemo, useState } from 'react';
import { useDictionary } from './useDictionary';
import { isCurrent } from './isCurrent';
import { normalizeText } from '../../access-groups/model/useUnitPicker';
import type { ListGroup, ListRow } from '../ui/DictionaryList.view';

const GROUPS = [
  { kind: 'vector', title: 'Lớp vectơ' },
  { kind: 'raster', title: 'Lớp ảnh' },
] as const;

/** The /du-lieu list: current feature types by kind, filtered by an accent-insensitive search. */
export function useDictionaryListPresenter() {
  const dictionary = useDictionary();
  const [query, onQuery] = useState('');

  const { groups, empty } = useMemo(() => {
    const q = normalizeText(query.trim());
    const current = Object.values(dictionary).filter((f) => isCurrent(f.validTo));
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

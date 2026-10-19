import { useCallback, useMemo, useState } from 'react';
import { ancestorsOf, type UnitNode, type UnitTree } from '@webatlas/shared';

/** Lower-case, strip combining marks, map đ to d: "Điện Hồng" -> "dien hong". */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

export interface PickerRow extends UnitNode {
  depth: number;
  selected: boolean;
  coveredByAncestor: boolean;
  /** Name of the selected ancestor that already covers this unit. */
  coveredByName: string | null;
  expanded: boolean;
  hasChildren: boolean;
  /** Rejected by the `allowed` filter. */
  disabled: boolean;
}

export interface UnitPickerOptions {
  onChange: (next: string[]) => void;
  mode?: 'multi' | 'single';
  allowed?: (code: string) => boolean;
}

const DEPTH = { country: 0, province: 1, ward: 2 } as const;

export function useUnitPicker(tree: UnitTree | null, selected: string[], options: UnitPickerOptions) {
  const { onChange, mode = 'multi', allowed } = options;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // Children per parent, in code order; built once per tree.
  const { children, searchKeys } = useMemo(() => {
    const kids = new Map<string, UnitNode[]>();
    const keys = new Map<string, string>();
    if (tree) {
      for (const n of tree.values()) {
        keys.set(n.code, `${normalizeText(n.name)} ${n.code.toLowerCase()}`);
        if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
      }
      for (const list of kids.values()) list.sort((a, b) => (a.code < b.code ? -1 : 1));
    }
    return { children: kids, searchKeys: keys };
  }, [tree]);

  const toggleExpand = useCallback((code: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }, []);

  const rows = useMemo<PickerRow[]>(() => {
    if (!tree) return [];
    const root = [...tree.values()].find((n) => n.level === 'country');
    if (!root) return [];
    const q = normalizeText(query.trim());
    const picked = new Set(selected);

    // With a search, show matches plus their ancestors as context.
    let visible: Set<string> | null = null;
    if (q) {
      visible = new Set();
      for (const [code, key] of searchKeys) {
        if (key.includes(q)) for (const a of ancestorsOf(tree, code)) visible.add(a);
      }
    }

    const out: PickerRow[] = [];
    const walk = (node: UnitNode) => {
      const kids = children.get(node.code) ?? [];
      const expanded = node.level === 'country' ? true
        : visible ? kids.some((k) => visible!.has(k.code)) : open.has(node.code);
      const coverer = mode === 'single' ? undefined
        : ancestorsOf(tree, node.code).slice(1).find((a) => picked.has(a));
      out.push({
        ...node,
        depth: DEPTH[node.level],
        selected: picked.has(node.code),
        coveredByAncestor: coverer !== undefined,
        coveredByName: coverer !== undefined ? tree.get(coverer)?.name ?? null : null,
        expanded,
        hasChildren: kids.length > 0,
        disabled: allowed ? !allowed(node.code) : false,
      });
      if (expanded) for (const k of kids) if (!visible || visible.has(k.code)) walk(k);
    };
    walk(root);
    return out;
  }, [tree, query, selected, open, children, searchKeys, mode, allowed]);

  const toggle = useCallback((code: string) => {
    if (!tree || !tree.has(code)) return;
    if (allowed && !allowed(code)) return;
    if (mode === 'single') { onChange([code]); return; }
    if (selected.includes(code)) { onChange(selected.filter((c) => c !== code)); return; }
    const chain = ancestorsOf(tree, code);
    if (chain.slice(1).some((a) => selected.includes(a))) return; // already covered
    // A broader unit replaces the narrower ones it now covers.
    const kept = selected.filter((c) => !ancestorsOf(tree, c).slice(1).includes(code));
    onChange([...kept, code].sort());
  }, [tree, selected, mode, allowed, onChange]);

  return { query, setQuery, rows, toggle, toggleExpand };
}

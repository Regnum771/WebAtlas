export type Operator = 'eq' | 'gte' | 'lte' | 'between';

export interface Condition {
  field: string;      // ISO property name on the feature
  op: Operator;
  value: unknown;
  value2?: unknown;   // upper bound for 'between'
}

// Minimal shape so tests need no OpenLayers. Real ol/Feature satisfies this.
export interface FeatureLike {
  getProperties(): Record<string, unknown>;
  getGeometry(): unknown;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function matchesCondition(props: Record<string, unknown>, c: Condition): boolean {
  const raw = props[c.field];
  if (raw === undefined || raw === null) return false;

  if (c.op === 'eq') {
    // Case-insensitive substring for text; exact-ish (lowercased) for enums too.
    return String(raw).toLowerCase().includes(String(c.value).toLowerCase());
  }
  const n = toNumber(raw);
  const a = toNumber(c.value);
  if (n === null || a === null) return false;
  if (c.op === 'gte') return n >= a;
  if (c.op === 'lte') return n <= a;
  if (c.op === 'between') {
    const b = toNumber(c.value2);
    if (b === null) return false;
    return n >= a && n <= b;
  }
  return false;
}

// AND semantics: a feature matches iff it satisfies EVERY condition.
// Empty conditions -> [] (no filter yields no list, per design §4.2).
export function applyFilter(features: FeatureLike[], conditions: Condition[]): FeatureLike[] {
  if (conditions.length === 0) return [];
  return features.filter((f) => {
    const props = f.getProperties();
    return conditions.every((c) => matchesCondition(props, c));
  });
}

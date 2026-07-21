export type Operator = 'eq' | 'contains' | 'gte' | 'lte' | 'between';

export interface Condition {
  field: string;      // ISO property name on the feature
  op: Operator;
  value: unknown;
  value2?: unknown;   // upper bound for 'between'
  scale?: number;     // divide the feature's raw value by this before comparing (e.g. metres -> km with 1000)
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

function norm(v: unknown): string {
  return String(v).trim().toLowerCase();
}

function matchesCondition(props: Record<string, unknown>, c: Condition): boolean {
  const raw = props[c.field];
  if (raw === undefined || raw === null) return false;

  // 'eq' is EXACT (normalised). It used to be a substring test, which meant an enum
  // value like 'xa_lu' also matched 'xa_lu_khan_cap'. Text fields that want substring
  // semantics ask for 'contains' explicitly.
  if (c.op === 'eq') return norm(raw) === norm(c.value);
  if (c.op === 'contains') return norm(raw).includes(norm(c.value));

  const rawN = toNumber(raw);
  const a = toNumber(c.value);
  if (rawN === null || a === null) return false;
  // Compare in the user's units: divide the feature's raw value by the field scale (default 1).
  const n = rawN / (c.scale && c.scale !== 0 ? c.scale : 1);
  if (c.op === 'gte') return n >= a;
  if (c.op === 'lte') return n <= a;
  if (c.op === 'between') {
    const b = toNumber(c.value2);
    if (b === null) return false;
    return n >= a && n <= b;
  }
  return false;
}

/**
 * AND semantics: a feature matches iff it satisfies EVERY condition.
 * No conditions means no predicate, so everything matches — deciding not to RENDER an
 * unfiltered list is a display concern and lives in the presenter.
 */
export function applyFilter(features: FeatureLike[], conditions: Condition[]): FeatureLike[] {
  if (conditions.length === 0) return [...features];
  return features.filter((f) => {
    const props = f.getProperties();
    return conditions.every((c) => matchesCondition(props, c));
  });
}

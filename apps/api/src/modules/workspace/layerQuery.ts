import type { z } from 'zod';
import { ValidationError } from '../../errors';
import { containsPattern } from '../../lib/like';
import type { LayerQueryBody as LayerQueryBodySchema, LayerQueryOp } from './schemas';

/*
 * The layer table's filter compiler: a table query (search box, conditions, all/any, "in view"
 * box, sort) turned into SQL fragments over a row alias `r` with columns `id`, `properties`
 * (jsonb) and `geom` (EPSG:4326). Pure: no database here; the route runs the fragments.
 *
 * Safety rules, which every fragment below follows:
 * - a field is accepted only if it is one of the layer's columns (unknown: 400);
 * - a JSON key is read as `r.properties ->> $n::text` with the key bound, never interpolated;
 * - every user value is a bound parameter. The only literals in the SQL are this file's own
 *   constants (the patterns below, '' and the SRID).
 */

export type ColumnType = 'text' | 'number' | 'date';
export interface Column {
  name: string;
  type: ColumnType;
}
export type Op = z.infer<typeof LayerQueryOp>;
export type LayerQueryBody = z.output<typeof LayerQueryBodySchema>;
type Condition = LayerQueryBody['conditions'][number];

export interface CompiledQuery {
  /** A boolean expression; 'true' when nothing filters. */
  where: string;
  /** An ORDER BY list, always ending in r.id so pages are stable. */
  orderBy: string;
  /** The values of $firstParam, $firstParam + 1, ... in order. */
  params: unknown[];
}

const OPS_BY_TYPE: Record<ColumnType, readonly Op[]> = {
  text: ['contains', 'eq', 'neq', 'empty', 'notEmpty'],
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'empty', 'notEmpty'],
  date: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'empty', 'notEmpty'],
};

const COMPARE: Record<'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte', string> = {
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

/*
 * The number pattern ^-?\d+(\.\d+)?$, spelt with [0-9] and [.]: Postgres's \d is [[:digit:]],
 * which under some collations also takes non-ASCII digits that ::numeric refuses, and with no
 * backslash the literal reads the same whatever standard_conforming_strings says. At most 30
 * digits on each side of the point, so no accepted value can overflow the cast.
 */
const NUMBER_RE = /^-?\d{1,30}(\.\d{1,30})?$/;
const NUMBER_SQL = "'^-?[0-9]{1,30}([.][0-9]{1,30})?$'";
/** The same cap for a value sent as a JSON number: under 10^30 in magnitude. */
const NUMBER_MAX = 1e30;
/** A date value is compared on its first ten characters, YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_SQL = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}'";

/** The 400 for a field that is not one of the layer's columns. */
export function unknownField(name: string): ValidationError {
  return new ValidationError(`Trường "${name}" không có trong lớp này.`, { field: name });
}

function badCondition(message: string): ValidationError {
  return new ValidationError('Validation failed', { fieldErrors: { conditions: [message] } });
}

export function compileQuery(columns: Column[], body: LayerQueryBody, firstParam: number): CompiledQuery {
  const params: unknown[] = [];
  /** Binds a value and returns its placeholder. */
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${firstParam + params.length - 1}`;
  };
  const byName = new Map(columns.map((c) => [c.name, c]));
  const column = (name: string): Column => {
    const found = byName.get(name);
    if (!found) throw unknownField(name);
    return found;
  };
  /** The column's value as text (SQL NULL when absent or JSON null), its key bound. */
  const textOf = (name: string) => `r.properties ->> ${bind(name)}::text`;

  const parts: string[] = [];

  const q = body.q?.trim();
  if (q) {
    const texts = columns.filter((c) => c.type === 'text');
    if (texts.length === 0) {
      // Nothing to search in: a search can match no row.
      parts.push('false');
    } else {
      const pattern = bind(containsPattern(q));
      parts.push(
        texts.map((c) => `workspace.fold_text(${textOf(c.name)}) LIKE workspace.fold_text(${pattern}::text)`).join(' OR ')
      );
    }
  }

  if (body.conditions.length > 0) {
    const compiled = body.conditions.map((c) => `(${condition(c)})`);
    const joined = compiled.join(body.match === 'any' ? ' OR ' : ' AND ');
    // One condition is its own group; several need their own parentheses within the AND below.
    parts.push(compiled.length === 1 ? joined.slice(1, -1) : joined);
  }

  if (body.bbox) {
    const [minX, minY, maxX, maxY] = body.bbox.map((n) => `${bind(n)}::float8`);
    parts.push(`r.geom && ST_MakeEnvelope(${minX}, ${minY}, ${maxX}, ${maxY}, 4326)`);
  }

  const where = parts.length === 0 ? 'true' : parts.map((p) => `(${p})`).join(' AND ');

  let orderBy = 'r.id';
  if (body.sort) {
    const col = column(body.sort.field);
    const v = `(${textOf(col.name)})`;
    // An empty string sorts with the missing values (NULLS LAST), not ahead of every other text.
    const key = col.type === 'number' ? `CASE WHEN ${v} ~ ${NUMBER_SQL} THEN ${v}::numeric END` : `NULLIF(${v}, '')`;
    orderBy = `${key} ${body.sort.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, r.id`;
  }

  return { where, orderBy, params };

  /** One condition as a boolean expression. Never raises at run time, whatever the row holds. */
  function condition(c: Condition): string {
    const col = column(c.field);
    if (!OPS_BY_TYPE[col.type].includes(c.op)) {
      throw new ValidationError(`Phép so sánh "${c.op}" không dùng được với trường "${col.name}".`, {
        field: col.name,
      });
    }
    // A tolerance only means something for eq/neq on numbers; anywhere else it is refused.
    if (c.tolerance !== undefined && !(col.type === 'number' && (c.op === 'eq' || c.op === 'neq'))) {
      throw new ValidationError(`Dung sai không dùng được với phép so sánh "${c.op}" trên trường "${col.name}".`, {
        field: col.name,
      });
    }
    if (c.op === 'empty' || c.op === 'notEmpty') {
      const v = `(${textOf(col.name)})`;
      return c.op === 'empty' ? `${v} IS NULL OR ${v} = ''` : `${v} IS NOT NULL AND ${v} <> ''`;
    }
    if (c.value === undefined) throw badCondition(`Operator "${c.op}" needs a value`);

    if (c.op === 'contains') {
      return `workspace.fold_text(${textOf(col.name)}) LIKE workspace.fold_text(${bind(containsPattern(String(c.value)))}::text)`;
    }
    const cmp = COMPARE[c.op];
    switch (col.type) {
      case 'text':
        // A missing value counts as '' so that eq and neq split the rows between them.
        return `COALESCE(${textOf(col.name)}, '') ${cmp} ${bind(String(c.value))}::text`;
      case 'number': {
        // A value that is not a number matches nothing, on either side. CASE (unlike AND) fixes
        // the order: the cast runs only on a value the pattern has accepted.
        const value =
          typeof c.value === 'number'
            ? Math.abs(c.value) < NUMBER_MAX
              ? c.value
              : null
            : NUMBER_RE.test(c.value.trim())
              ? c.value.trim()
              : null;
        if (value === null) return 'false';
        const v = `(${textOf(col.name)})`;
        if (c.tolerance !== undefined) {
          // eq: within the tolerance; neq: beyond it. A missing value still matches neither.
          const within = c.op === 'eq' ? '<=' : '>';
          return `CASE WHEN ${v} ~ ${NUMBER_SQL} THEN abs(${v}::numeric - ${bind(value)}::numeric) ${within} ${bind(c.tolerance)}::numeric ELSE false END`;
        }
        return `CASE WHEN ${v} ~ ${NUMBER_SQL} THEN ${v}::numeric ${cmp} ${bind(value)}::numeric ELSE false END`;
      }
      case 'date': {
        // Compared as YYYY-MM-DD text; a stored value of another shape matches nothing.
        if (typeof c.value !== 'string' || !DATE_RE.test(c.value.trim())) return 'false';
        const key = bind(col.name);
        return (
          `(r.properties ->> ${key}::text) ~ ${DATE_SQL}` +
          ` AND left(r.properties ->> ${key}::text, 10) ${cmp} ${bind(c.value.trim())}::text`
        );
      }
    }
  }
}

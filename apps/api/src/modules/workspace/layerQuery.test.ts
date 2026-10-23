import { describe, it, expect } from 'vitest';
import { compileQuery, type Column } from './layerQuery';
import { LayerQueryBody } from './schemas';
import { ValidationError } from '../../errors';

// The filter compiler is pure: these tests read the SQL text and the bound parameters it
// produces, with no database. The route's tests run that SQL for real.

const COLUMNS: Column[] = [
  { name: 'ten', type: 'text' },
  { name: 'loai', type: 'text' },
  { name: 'cong_suat', type: 'number' },
  { name: 'ngay', type: 'date' },
];

/** The number guard: only an ASCII decimal is ever cast to numeric. */
const NUM = "'^-?[0-9]{1,30}([.][0-9]{1,30})?$'";

const body = (input: unknown) => LayerQueryBody.parse(input);

/** Every $n placeholder in the SQL. */
const placeholders = (sql: string) => [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

describe('compileQuery', () => {
  it('an unknown field is refused with the Vietnamese message', () => {
    const run = () => compileQuery(COLUMNS, body({ conditions: [{ field: 'khong_co', op: 'eq', value: 'x' }] }), 1);
    expect(run).toThrow(ValidationError);
    expect(run).toThrow('Trường "khong_co" không có trong lớp này.');

    const sortRun = () => compileQuery(COLUMNS, body({ sort: { field: 'khong_co', dir: 'asc' } }), 1);
    expect(sortRun).toThrow(ValidationError);
    expect(sortRun).toThrow('Trường "khong_co" không có trong lớp này.');
  });

  it('a number operator on a text column is refused', () => {
    const run = () => compileQuery(COLUMNS, body({ conditions: [{ field: 'ten', op: 'gt', value: 5 }] }), 1);
    expect(run).toThrow(ValidationError);
    expect(run).toThrow('Phép so sánh "gt" không dùng được với trường "ten".');
    // ... and a text operator on a number or date column likewise.
    expect(() =>
      compileQuery(COLUMNS, body({ conditions: [{ field: 'cong_suat', op: 'contains', value: '5' }] }), 1)
    ).toThrow(ValidationError);
    expect(() =>
      compileQuery(COLUMNS, body({ conditions: [{ field: 'ngay', op: 'contains', value: '2024' }] }), 1)
    ).toThrow(ValidationError);
  });

  it('keys with quotes and SQL text are bound, never interpolated', () => {
    const evil: Column[] = [
      { name: "a'b", type: 'text' },
      { name: 'x"; DROP TABLE t;--', type: 'number' },
    ];
    const out = compileQuery(
      evil,
      body({
        q: "o'neil",
        conditions: [
          { field: "a'b", op: 'eq', value: "DROP'--" },
          { field: 'x"; DROP TABLE t;--', op: 'gt', value: 3 },
        ],
        sort: { field: 'x"; DROP TABLE t;--', dir: 'desc' },
      }),
      1
    );
    const sql = `${out.where} ${out.orderBy}`;
    expect(sql).not.toContain("a'b");
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('neil');
    expect(out.params).toContain("a'b");
    expect(out.params).toContain('x"; DROP TABLE t;--');
    expect(out.params).toContain("DROP'--");
    // Every key is read through ->> with a bound placeholder, never a literal.
    expect(sql.match(/->>/g)?.length).toBe(sql.match(/->> \$\d+::text/g)?.length);
  });

  it('a non-numeric value never matches a number condition and never errors', () => {
    const out = compileQuery(COLUMNS, body({ conditions: [{ field: 'cong_suat', op: 'gte', value: 50 }] }), 1);
    // The cast to numeric sits inside a CASE that first tests the number pattern, so a stored
    // "N/A" or "1.200,5" yields false instead of a cast error (CASE fixes the evaluation order).
    expect(out.where).toBe(
      `(CASE WHEN (r.properties ->> $1::text) ~ ${NUM} THEN (r.properties ->> $1::text)::numeric >= $2::numeric ELSE false END)`
    );
    expect(out.params).toEqual(['cong_suat', 50]);

    // A user value that is not a number compiles to false, without binding anything.
    const bad = compileQuery(COLUMNS, body({ conditions: [{ field: 'cong_suat', op: 'lt', value: 'N/A' }] }), 1);
    expect(bad.where).toBe('(false)');
    expect(bad.params).toEqual([]);

    // A numeric string is accepted as the number it spells.
    const ok = compileQuery(COLUMNS, body({ conditions: [{ field: 'cong_suat', op: 'eq', value: '12.5' }] }), 1);
    expect(ok.params).toEqual(['cong_suat', '12.5']);
  });

  it('the number guard caps digits at 30 on each side, for stored and sent values', () => {
    const cond = (value: string | number) =>
      compileQuery(COLUMNS, body({ conditions: [{ field: 'cong_suat', op: 'gt', value }] }), 1);
    // Stored values: the guard's pattern caps the digit count, so a huge one is never cast.
    expect(cond(1).where).toContain("~ '^-?[0-9]{1,30}([.][0-9]{1,30})?$' THEN");
    // Sent values: 30 digits on each side pass; 31 on either side compile to false.
    const d30 = '9'.repeat(30);
    expect(cond(`-${d30}.${d30}`).params).toEqual(['cong_suat', `-${d30}.${d30}`]);
    expect(cond(`${d30}9`)).toEqual({ where: '(false)', orderBy: 'r.id', params: [] });
    expect(cond(`1.${d30}9`)).toEqual({ where: '(false)', orderBy: 'r.id', params: [] });
    // A JSON number: under 10^30 in magnitude is bound; 10^30 and beyond is false.
    expect(cond(1e29).params).toEqual(['cong_suat', 1e29]);
    expect(cond(-1e30).where).toBe('(false)');
    expect(cond(1e300).where).toBe('(false)');
  });

  it('match any joins with OR; search and bbox still AND', () => {
    const out = compileQuery(
      COLUMNS,
      body({
        q: 'sông',
        match: 'any',
        conditions: [
          { field: 'loai', op: 'eq', value: 'thuy_dien' },
          { field: 'cong_suat', op: 'gt', value: 50 },
        ],
        bbox: [107.9, 15.9, 108.4, 16.2],
      }),
      1
    );
    expect(out.where).toBe(
      // The search ORs contains over the two text columns only, reusing one pattern.
      '(workspace.fold_text(r.properties ->> $2::text) LIKE workspace.fold_text($1::text)' +
        ' OR workspace.fold_text(r.properties ->> $3::text) LIKE workspace.fold_text($1::text))' +
        " AND ((COALESCE(r.properties ->> $4::text, '') = $5::text)" +
        ` OR (CASE WHEN (r.properties ->> $6::text) ~ ${NUM} THEN (r.properties ->> $6::text)::numeric > $7::numeric ELSE false END))` +
        ' AND (r.geom && ST_MakeEnvelope($8::float8, $9::float8, $10::float8, $11::float8, 4326))'
    );
    expect(out.params).toEqual(['%sông%', 'ten', 'loai', 'loai', 'thuy_dien', 'cong_suat', 50, 107.9, 15.9, 108.4, 16.2]);

    // match all joins the conditions with AND.
    const all = compileQuery(
      COLUMNS,
      body({ conditions: [{ field: 'loai', op: 'empty' }, { field: 'ten', op: 'notEmpty' }] }),
      1
    );
    expect(all.where).toBe(
      "(((r.properties ->> $1::text) IS NULL OR (r.properties ->> $1::text) = '')" +
        " AND ((r.properties ->> $2::text) IS NOT NULL AND (r.properties ->> $2::text) <> ''))"
    );

    // Nothing to filter: everything matches. A blank search is no search.
    expect(compileQuery(COLUMNS, body({}), 1)).toEqual({ where: 'true', orderBy: 'r.id', params: [] });
    expect(compileQuery(COLUMNS, body({ q: '   ' }), 1).where).toBe('true');
  });

  it('contains escapes % and _', () => {
    const out = compileQuery(COLUMNS, body({ conditions: [{ field: 'ten', op: 'contains', value: '50%_a\\b' }] }), 1);
    expect(out.params).toEqual(['ten', '%50\\%\\_a\\\\b%']);
    expect(out.where).toBe('(workspace.fold_text(r.properties ->> $1::text) LIKE workspace.fold_text($2::text))');

    const search = compileQuery(COLUMNS, body({ q: '  100%  ' }), 1);
    expect(search.params[0]).toBe('%100\\%%');
  });

  it('params are numbered from firstParam', () => {
    const out = compileQuery(
      COLUMNS,
      body({
        q: 'a',
        conditions: [
          { field: 'ten', op: 'neq', value: 'b' },
          { field: 'ngay', op: 'lt', value: '2024-01-31' },
        ],
        bbox: [1, 2, 3, 4],
        sort: { field: 'cong_suat', dir: 'desc' },
      }),
      4
    );
    const used = [...new Set(placeholders(`${out.where} ${out.orderBy}`))].sort((a, b) => a - b);
    expect(used).toEqual(out.params.map((_, i) => i + 4));
    expect(used[0]).toBe(4);
  });

  it('orders by the sort column, numeric-aware, NULLS LAST, then r.id', () => {
    const num = compileQuery(COLUMNS, body({ sort: { field: 'cong_suat', dir: 'desc' } }), 1);
    expect(num.orderBy).toBe(
      `CASE WHEN (r.properties ->> $1::text) ~ ${NUM} THEN (r.properties ->> $1::text)::numeric END DESC NULLS LAST, r.id`
    );
    expect(num.params).toEqual(['cong_suat']);

    const text = compileQuery(COLUMNS, body({ sort: { field: 'ten', dir: 'asc' } }), 1);
    expect(text.orderBy).toBe('(r.properties ->> $1::text) ASC NULLS LAST, r.id');
  });

  it('dates compare as YYYY-MM-DD text and need a date-shaped value', () => {
    const out = compileQuery(COLUMNS, body({ conditions: [{ field: 'ngay', op: 'gte', value: '2024-01-31' }] }), 1);
    expect(out.where).toBe(
      "((r.properties ->> $1::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND left(r.properties ->> $1::text, 10) >= $2::text)"
    );
    expect(out.params).toEqual(['ngay', '2024-01-31']);
    const bad = compileQuery(COLUMNS, body({ conditions: [{ field: 'ngay', op: 'gte', value: 'hôm qua' }] }), 1);
    expect(bad.where).toBe('(false)');
  });

  it('an operator that needs a value is refused without one', () => {
    expect(() => compileQuery(COLUMNS, body({ conditions: [{ field: 'ten', op: 'eq' }] }), 1)).toThrow(ValidationError);
  });

  it('the body schema applies its defaults and limits', () => {
    expect(body({})).toEqual({ conditions: [], match: 'all', offset: 0, limit: 100 });
    expect(() => body({ limit: 501 })).toThrow();
    expect(() => body({ limit: 0 })).toThrow();
    expect(() => body({ offset: -1 })).toThrow();
    expect(() => body({ q: 'x'.repeat(201) })).toThrow();
    expect(() => body({ conditions: Array.from({ length: 11 }, () => ({ field: 'ten', op: 'empty' })) })).toThrow();
    expect(() => body({ conditions: [{ field: 'ten', op: 'like', value: 'x' }] })).toThrow();
    expect(() => body({ bbox: [1, 2, 3] })).toThrow();
    expect(() => body({ sort: { field: 'ten', dir: 'up' } })).toThrow();
  });
});

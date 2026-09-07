import { describe, it, expect } from 'vitest';
import { guardSql, SQL_ROW_LIMIT } from './guard';

function reject(sql: string) {
  const result = guardSql(sql);
  expect(result.ok, `expected rejection for: ${sql}`).toBe(false);
  return result;
}

describe('guardSql — accepts', () => {
  it('a plain SELECT', () => {
    const r = guardSql('SELECT name FROM water.dams_active');
    expect(r.ok).toBe(true);
  });

  it('a WITH query', () => {
    expect(guardSql('WITH x AS (SELECT 1 AS n) SELECT n FROM x').ok).toBe(true);
  });

  it('a trailing semicolon, which is ordinary and harmless', () => {
    expect(guardSql('SELECT 1;').ok).toBe(true);
  });

  it('wraps the query in an enforced LIMIT', () => {
    const r = guardSql('SELECT name FROM water.dams_active');
    expect(r.ok && r.sql).toContain(`LIMIT ${SQL_ROW_LIMIT}`);
  });

  it('keeps the caller LIMIT and still applies its own outer one', () => {
    const r = guardSql('SELECT name FROM water.dams_active LIMIT 5');
    expect(r.ok && r.sql).toContain('LIMIT 5');
    expect(r.ok && r.sql).toContain(`LIMIT ${SQL_ROW_LIMIT}`);
  });
});

describe('guardSql — rejects', () => {
  it('a second statement', () => reject('SELECT 1; DELETE FROM water.dams'));
  it('a write disguised after a SELECT', () => reject('SELECT 1;DROP TABLE water.dams'));
  it('a bare write', () => reject('DELETE FROM water.dams'));
  it('an UPDATE', () => reject('UPDATE water.dams SET name = 1'));
  it('an INSERT', () => reject("INSERT INTO water.dams(name) VALUES ('x')"));
  it('a data-modifying CTE', () => reject('WITH x AS (DELETE FROM water.dams RETURNING 1) SELECT * FROM x'));
  it('DDL', () => reject('CREATE TABLE t (a int)'));
  it('a GRANT', () => reject('GRANT SELECT ON app.users TO webatlas_assistant'));
  it('COPY', () => reject("COPY water.dams TO '/tmp/x'"));
  it('a line comment, which can hide the rest of a statement', () => reject('SELECT 1 -- DROP TABLE x'));
  it('a block comment', () => reject('SELECT /* sneaky */ 1'));
  it('a server-side file read', () => reject("SELECT pg_read_file('/etc/passwd')"));
  it('a sleep, which would hold a connection', () => reject('SELECT pg_sleep(10)'));
  it('an empty query', () => reject('   '));
  it('a query beyond the length cap', () => reject(`SELECT '${'a'.repeat(4000)}'`));
});

describe('guardSql — does not reject on substrings', () => {
  it('allows a column named created_at even though it contains "create"', () => {
    expect(guardSql('SELECT created_at FROM water.dams_active').ok).toBe(true);
  });

  it('allows OFFSET even though it contains "set"', () => {
    expect(guardSql('SELECT name FROM water.dams_active OFFSET 5').ok).toBe(true);
  });

  it('allows a column named updated_at even though it contains "update"', () => {
    expect(guardSql('SELECT updated_at FROM water.dams_active').ok).toBe(true);
  });
});

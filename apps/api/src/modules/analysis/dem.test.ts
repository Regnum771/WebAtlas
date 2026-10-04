import { describe, it, expect } from 'vitest';
import { demAvailable } from './dem';
import type { Queryable } from '../assistant/tools/data/helpers';

/** Answers each query in turn with one row `{ ok }`, and records the SQL it was asked. */
function fakeDb(answers: boolean[]) {
  const asked: string[] = [];
  const db = {
    query: async (sql: string) => {
      asked.push(sql);
      return { rows: [{ ok: answers[asked.length - 1] }] };
    },
  } as unknown as Queryable;
  return { db, asked };
}

describe('demAvailable', () => {
  it('is false when the relation does not exist, and never queries it', async () => {
    // Querying a missing relation inside the analysis transaction would abort it (25P02).
    const { db, asked } = fakeDb([false]);
    expect(await demAvailable(db)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('to_regclass');
  });

  it('is false when the table exists but is empty, which is what migrations leave behind', async () => {
    const { db, asked } = fakeDb([true, false]);
    expect(await demAvailable(db)).toBe(false);
    expect(asked).toHaveLength(2);
  });

  it('is true when the table holds a row', async () => {
    const { db } = fakeDb([true, true]);
    expect(await demAvailable(db)).toBe(true);
  });
});

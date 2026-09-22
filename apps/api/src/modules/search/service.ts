import type { Pool } from 'pg';
import { searchByName, type SearchHit } from './repository';

export function searchService(pool: Pool) {
  return {
    search: (q: string, limit: number, sources?: readonly string[]): Promise<SearchHit[]> =>
      searchByName(pool, q, limit, sources),
  };
}

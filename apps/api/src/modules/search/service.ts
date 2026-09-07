import type { Pool } from 'pg';
import { searchByName, type SearchHit } from './repository';

export function searchService(pool: Pool) {
  return {
    search: (q: string, limit: number): Promise<SearchHit[]> => searchByName(pool, q, limit),
  };
}

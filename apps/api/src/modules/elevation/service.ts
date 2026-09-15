import type { Pool } from 'pg';
import { elevationAt, type ElevationResult } from './repository';

export function elevationService(pool: Pool) {
  return {
    at: (lon: number, lat: number): Promise<ElevationResult> => elevationAt(pool, lon, lat),
  };
}

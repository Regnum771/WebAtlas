import { apiRequest } from '../../../shared/api/apiClient';

/** Mirrors the API's tri-state (modules/elevation/repository.ts): a real value, a covered
 *  gap, or a deployment that has never loaded the DEM. */
export interface ElevationResponse {
  status: 'ok' | 'nodata' | 'unavailable';
  elevationM: number | null;
  source: string | null;
}

export function fetchElevation(lon: number, lat: number, signal?: AbortSignal): Promise<ElevationResponse> {
  return apiRequest<ElevationResponse>(
    `/api/elevation?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`,
    { signal }
  );
}

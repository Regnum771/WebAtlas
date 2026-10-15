import type {
  FloodPlanRow, FloodScenarioDetail, FloodScenarioId, FloodScenarioSummary,
} from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';

export interface FloodRoadsCollection {
  type: 'FeatureCollection';
  features: readonly { type: 'Feature'; geometry: unknown; properties: { cutHour: number; name: string | null } }[];
}

export function fetchScenarios(): Promise<FloodScenarioSummary[]> {
  return apiRequest<FloodScenarioSummary[]>('/api/scenarios');
}

export function fetchScenario(id: FloodScenarioId): Promise<FloodScenarioDetail> {
  return apiRequest<FloodScenarioDetail>(`/api/scenarios/${id}`);
}

export function fetchRoads(id: FloodScenarioId): Promise<FloodRoadsCollection> {
  return apiRequest<FloodRoadsCollection>(`/api/scenarios/${id}/roads`);
}

export function fetchPlan(id: FloodScenarioId): Promise<FloodPlanRow[]> {
  return apiRequest<FloodPlanRow[]>(`/api/scenarios/${id}/plan`);
}

export function frameUrl(id: FloodScenarioId, hour: number): string {
  return `${API_BASE_URL}/api/scenarios/${id}/frames/${hour}`;
}

const PRELOAD_CONCURRENCY = 6;

/** Loads frames 0..hours into the browser cache, 6 at a time; rejects on the first that fails. */
export async function preloadFrames(id: FloodScenarioId, hours: number, onProgress: (loaded: number) => void): Promise<void> {
  let next = 0;
  let loaded = 0;
  const one = (hour: number) => new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`frame ${hour}`));
    img.src = frameUrl(id, hour);
  });
  const worker = async () => {
    while (next <= hours) {
      const hour = next++;
      await one(hour);
      onProgress(++loaded);
    }
  };
  await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
}

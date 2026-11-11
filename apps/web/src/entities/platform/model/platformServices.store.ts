import { useEffect, useSyncExternalStore } from 'react';
import { apiRequest } from '../../../shared/api/apiClient';
import type { PlatformService, PlatformServiceId } from './platform.types';

export interface PlatformServicesState {
  /** null until the first answer arrives. */
  services: PlatformService[] | null;
  /** The last request failed; `services` keeps the previous answer, if any. */
  failed: boolean;
}

const REFRESH_MS = 60_000;

let state: PlatformServicesState = { services: null, failed: false };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

function set(next: PlatformServicesState) {
  state = next;
  for (const l of listeners) l();
}

export function refreshPlatformServices(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = apiRequest<{ services: PlatformService[] }>('/api/platform/services')
    .then(({ services }) => set({ services, failed: false }))
    .catch(() => set({ services: state.services, failed: true }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The platform's external services; refreshed every minute while any component shows them. */
export function usePlatformServices(): PlatformServicesState {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      void refreshPlatformServices();
      timer = setInterval(() => { void refreshPlatformServices(); }, REFRESH_MS);
    }
    return () => {
      users -= 1;
      if (users === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

export function findService(services: PlatformService[] | null, id: PlatformServiceId): PlatformService | null {
  return services?.find((s) => s.id === id) ?? null;
}

/** Tests only. */
export function resetPlatformServicesForTest() {
  state = { services: null, failed: false };
  inFlight = null;
  if (timer) clearInterval(timer);
  timer = null;
  users = 0;
}

import { z } from 'zod';

export type PlatformServiceId = 'geonode' | 'dagster' | 'keycloak';
export type ServiceStatus = 'up' | 'down' | 'unconfigured';

export interface PlatformService {
  id: PlatformServiceId;
  label: string;
  /** Where a browser opens the service; null when it is not configured. */
  url: string | null;
  status: ServiceStatus;
  checkedAt: string;
}

const Url = z.string().url().optional().or(z.literal('').transform(() => undefined));
const PlatformEnv = z.object({
  PLATFORM_GEONODE_URL: Url,
  PLATFORM_DAGSTER_URL: Url,
  PLATFORM_KEYCLOAK_URL: Url,
  PLATFORM_KEYCLOAK_REALM: z.string().min(1).default('webatlas'),
});

interface ServiceDef {
  id: PlatformServiceId;
  label: string;
  /** Browser URL and health URL from the configured base, or null when the base is unset. */
  resolve: (env: z.infer<typeof PlatformEnv>) => { url: string; health: string } | null;
}

const trim = (u: string) => u.replace(/\/+$/, '');

const DEFS: readonly ServiceDef[] = [
  {
    id: 'geonode',
    label: 'Danh mục bản đồ',
    resolve: (e) => e.PLATFORM_GEONODE_URL ? { url: `${trim(e.PLATFORM_GEONODE_URL)}/`, health: `${trim(e.PLATFORM_GEONODE_URL)}/api/v2/` } : null,
  },
  {
    id: 'dagster',
    label: 'Điều phối dữ liệu',
    // /server_info is the one Dagster path oauth2-proxy lets through without a sign-in.
    resolve: (e) => e.PLATFORM_DAGSTER_URL ? { url: `${trim(e.PLATFORM_DAGSTER_URL)}/`, health: `${trim(e.PLATFORM_DAGSTER_URL)}/server_info` } : null,
  },
  {
    id: 'keycloak',
    label: 'Tài khoản',
    resolve: (e) => {
      if (!e.PLATFORM_KEYCLOAK_URL) return null;
      const realm = `${trim(e.PLATFORM_KEYCLOAK_URL)}/realms/${encodeURIComponent(e.PLATFORM_KEYCLOAK_REALM)}`;
      return { url: `${realm}/account`, health: `${realm}/.well-known/openid-configuration` };
    },
  },
];

const CACHE_MS = 30_000;
const TIMEOUT_MS = 2_000;

interface Probe { status: 'up' | 'down'; at: number }

/** Probes each configured service at most once per CACHE_MS; concurrent callers share one probe. */
export function platformServices(fetchFn: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, Probe>();
  const inFlight = new Map<string, Promise<Probe>>();

  async function probe(health: string): Promise<Probe> {
    const cached = cache.get(health);
    if (cached && now() - cached.at < CACHE_MS) return cached;
    const running = inFlight.get(health);
    if (running) return running;
    const p = (async (): Promise<Probe> => {
      let status: Probe['status'] = 'down';
      try {
        const res = await fetchFn(health, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        status = res.ok ? 'up' : 'down';
      } catch {
        status = 'down';
      }
      const result = { status, at: now() };
      cache.set(health, result);
      return result;
    })().finally(() => inFlight.delete(health));
    inFlight.set(health, p);
    return p;
  }

  return async function list(env: NodeJS.ProcessEnv = process.env): Promise<PlatformService[]> {
    const parsed = PlatformEnv.parse(env);
    return Promise.all(DEFS.map(async (def): Promise<PlatformService> => {
      const where = def.resolve(parsed);
      if (!where) return { id: def.id, label: def.label, url: null, status: 'unconfigured', checkedAt: new Date(now()).toISOString() };
      const p = await probe(where.health);
      return { id: def.id, label: def.label, url: where.url, status: p.status, checkedAt: new Date(p.at).toISOString() };
    }));
  };
}

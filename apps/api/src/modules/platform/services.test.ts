import { describe, expect, it, vi } from 'vitest';
import { platformServices } from './services';

const ok = (..._args: Parameters<typeof fetch>) => Promise.resolve(new Response('{}', { status: 200 }));

describe('platformServices', () => {
  it('reports every service as unconfigured when no URL is set', async () => {
    const fetchFn = vi.fn(ok);
    const list = await platformServices(fetchFn)({});
    expect(list.map((s) => [s.id, s.status, s.url])).toEqual([
      ['geonode', 'unconfigured', null],
      ['dagster', 'unconfigured', null],
      ['keycloak', 'unconfigured', null],
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('probes the health path of each configured service and links its browser URL', async () => {
    const fetchFn = vi.fn(ok);
    const list = await platformServices(fetchFn)({
      PLATFORM_GEONODE_URL: 'http://localhost:8000/',
      PLATFORM_DAGSTER_URL: 'http://localhost:3070',
      PLATFORM_KEYCLOAK_URL: 'http://localhost:8180',
    });
    expect(fetchFn.mock.calls.map((c) => c[0]).sort()).toEqual([
      'http://localhost:3070/server_info',
      'http://localhost:8000/api/v2/',
      'http://localhost:8180/realms/webatlas/.well-known/openid-configuration',
    ]);
    expect(list.map((s) => [s.id, s.status, s.url])).toEqual([
      ['geonode', 'up', 'http://localhost:8000/'],
      ['dagster', 'up', 'http://localhost:3070/'],
      ['keycloak', 'up', 'http://localhost:8180/realms/webatlas/account'],
    ]);
  });

  it('reports down on an error status, a redirect or a network failure', async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('8000')) return Promise.resolve(new Response('', { status: 502 }));
      if (u.includes('3070')) return Promise.resolve(new Response(null, { status: 302 }));
      return Promise.reject(new TypeError('fetch failed'));
    });
    const list = await platformServices(fetchFn as typeof fetch)({
      PLATFORM_GEONODE_URL: 'http://localhost:8000',
      PLATFORM_DAGSTER_URL: 'http://localhost:3070',
      PLATFORM_KEYCLOAK_URL: 'http://localhost:8180',
    });
    expect(list.map((s) => s.status)).toEqual(['down', 'down', 'down']);
  });

  it('caches a probe for 30 s and shares one probe between concurrent callers', async () => {
    let t = 1_000;
    const fetchFn = vi.fn(ok);
    const list = platformServices(fetchFn, () => t);
    const env = { PLATFORM_GEONODE_URL: 'http://localhost:8000' };
    await Promise.all([list(env), list(env)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t += 29_000;
    await list(env);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t += 2_000;
    await list(env);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('treats an empty URL as unset', async () => {
    const list = await platformServices(vi.fn(ok))({ PLATFORM_GEONODE_URL: '' });
    expect(list[0].status).toBe('unconfigured');
  });
});

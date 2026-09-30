import { describe, it, expect } from 'vitest';
import { geoserverEnv, publishLayer } from './geoserver';

const gs = geoserverEnv({
  GEOSERVER_URL: 'http://gs/geoserver', GEOSERVER_ADMIN_USER: 'admin', GEOSERVER_ADMIN_PASSWORD: 'pw',
  GEOSERVER_WORKSPACE: 'webatlas', GEOSERVER_DB_PASSWORD: 'dbpw',
});

type Call = { method: string; path: string; body?: unknown };

/** A fetch that answers from a script keyed by "METHOD path" and records every call. */
function scripted(routes: Record<string, { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const path = url.replace('http://gs/geoserver/rest', '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes[`${method} ${path}`] ?? { status: 404 };
    return new Response(hit.json ? JSON.stringify(hit.json) : 'x', { status: hit.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const READY = {
  'GET /workspaces/webatlas': { status: 200 },
  'GET /workspaces/webatlas/datastores/webatlas_water': { status: 200 },
  'POST /reset': { status: 200 },
};
const FT = '/workspaces/webatlas/datastores/webatlas_water/featuretypes';

describe('geoserverEnv', () => {
  it('fails clearly without GEOSERVER_URL', () => {
    expect(() => geoserverEnv({})).toThrow(/GEOSERVER_URL is not set/);
  });
});

describe('publishLayer', () => {
  it('leaves a layer that already points at the right relation untouched', async () => {
    const f = scripted({ ...READY, [`GET ${FT}/rivers`]: { status: 200, json: { featureType: { nativeName: 'rivers_detail' } } } });
    expect(await publishLayer(gs, { layer: 'rivers', nativeName: 'rivers_detail' }, f.impl)).toBe('unchanged');
    expect(f.calls.filter((c) => c.method !== 'GET')).toEqual([{ method: 'POST', path: '/reset', body: undefined }]);
  });

  it('repoints with PUT (so styles survive) and resets the catalog', async () => {
    const f = scripted({
      ...READY,
      [`GET ${FT}/rivers`]: { status: 200, json: { featureType: { nativeName: 'rivers_active' } } },
      [`PUT ${FT}/rivers`]: { status: 200 },
      'POST /reset': { status: 200 },
    });
    expect(await publishLayer(gs, { layer: 'rivers', nativeName: 'rivers_detail' }, f.impl)).toBe('repointed');
    expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({ featureType: { name: 'rivers', nativeName: 'rivers_detail' } });
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', path: '/reset' });
  });

  it('creates a missing layer on the <layer>_active view by default', async () => {
    const f = scripted({ ...READY, [`POST ${FT}`]: { status: 201 } });
    expect(await publishLayer(gs, { layer: 'dams' }, f.impl)).toBe('created');
    expect(f.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ featureType: { name: 'dams', nativeName: 'dams_active' } });
  });

  it('creates the workspace and datastore when missing', async () => {
    const f = scripted({
      'POST /workspaces': { status: 201 },
      'POST /workspaces/webatlas/datastores': { status: 201 },
      [`POST ${FT}`]: { status: 201 },
      'POST /reset': { status: 200 },
    });
    await publishLayer(gs, { layer: 'dams' }, f.impl);
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/workspaces', '/workspaces/webatlas/datastores', FT, '/reset',
    ]);
  });

  it('fails the stage on any non-2xx response, naming status and path', async () => {
    const f = scripted({ ...READY, [`POST ${FT}`]: { status: 500 } });
    await expect(publishLayer(gs, { layer: 'dams' }, f.impl)).rejects.toThrow(/500/);
  });

  it('fails on a 401 from the workspace check without POSTing', async () => {
    const f = scripted({ 'GET /workspaces/webatlas': { status: 401 } });
    await expect(publishLayer(gs, { layer: 'dams' }, f.impl)).rejects.toThrow(/check workspace webatlas failed: 401/);
    expect(f.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('fails on a 500 from the featuretype check without POSTing', async () => {
    const f = scripted({ ...READY, [`GET ${FT}/dams`]: { status: 500 } });
    await expect(publishLayer(gs, { layer: 'dams' }, f.impl)).rejects.toThrow(/check featuretype dams failed: 500/);
    expect(f.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('resets the catalog after a create too', async () => {
    const f = scripted({ ...READY, [`POST ${FT}`]: { status: 201 }, 'POST /reset': { status: 200 } });
    await publishLayer(gs, { layer: 'dams' }, f.impl);
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', path: '/reset' });
  });

  it('assigns a default style when one is given', async () => {
    const f = scripted({
      ...READY,
      [`GET ${FT}/dams`]: { status: 200, json: { featureType: { nativeName: 'dams_active' } } },
      'PUT /layers/webatlas:dams': { status: 200 },
    });
    await publishLayer(gs, { layer: 'dams', style: 'dams_style' }, f.impl);
    expect(f.calls.find((c) => c.path === '/layers/webatlas:dams')?.body).toEqual({
      layer: { defaultStyle: { name: 'dams_style' } },
    });
  });
});

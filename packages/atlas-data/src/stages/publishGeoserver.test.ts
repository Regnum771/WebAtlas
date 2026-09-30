import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { executePublishGeoserver } from './publishGeoserver';

const pool = {} as Pool;
const env = { GEOSERVER_URL: 'http://gs/geoserver', GEOSERVER_ADMIN_PASSWORD: 'pw' };

/** A scripted fetch (it ignores `signal`) keyed by "METHOD path". */
function scripted(routes: Record<string, { status: number; json?: unknown }>) {
  return (async (url: string, init?: RequestInit) => {
    const path = url.replace('http://gs/geoserver/rest', '');
    const hit = routes[`${init?.method ?? 'GET'} ${path}`] ?? { status: 404 };
    return new Response(hit.json ? JSON.stringify(hit.json) : 'x', { status: hit.status });
  }) as unknown as typeof fetch;
}

const FT = '/workspaces/webatlas/datastores/webatlas_water/featuretypes';

describe('executePublishGeoserver', () => {
  it('records "<ws>:<layer> → <relation> (<outcome>)" and logs it — the format is written to lineage', async () => {
    const f = scripted({
      'GET /workspaces/webatlas': { status: 200 },
      'GET /workspaces/webatlas/datastores/webatlas_water': { status: 200 },
      [`GET ${FT}/dams`]: { status: 200, json: { featureType: { nativeName: 'dams_active' } } },
      'POST /reset': { status: 200 },
    });
    const lines: string[] = [];
    const ctx = { datasetId: 'dams', forced: false, log: (l: string) => lines.push(l) };
    const r = await executePublishGeoserver(pool, { type: 'publish-geoserver', layer: 'dams' }, ctx, env, f);
    expect(r.summary).toBe('webatlas:dams → dams_active (unchanged)');
    expect(lines).toEqual(['[dams] webatlas:dams unchanged']);
  });
});

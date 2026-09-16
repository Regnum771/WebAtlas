import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { gsRequest, gsExists } from './client';

const WS = process.env.GEOSERVER_WORKSPACE ?? 'webatlas';
const STORE = `${WS}_water`;
const TABLES = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
  'rivers_overview',
];

/**
 * Các lớp DẪN XUẤT không có view `_active` đi kèm — bản thân chúng đã là quan hệ
 * cuối cùng. Tách ra thành hàm riêng có kiểm thử vì gọi nhầm sẽ khiến GeoServer
 * đi tìm `rivers_overview_active` rồi trả 500 rất khó lần ra nguyên nhân.
 */
const DERIVED_TABLES = new Set(['rivers_overview']);

export function nativeNameFor(table: string): string {
  return DERIVED_TABLES.has(table) ? table : `${table}_active`;
}

async function ensureWorkspace(): Promise<void> {
  if (await gsExists(`/workspaces/${WS}`)) return;
  const res = await gsRequest('POST', '/workspaces', { workspace: { name: WS } });
  if (!res.ok) throw new Error(`create workspace failed: ${res.status} ${await res.text()}`);
}

async function ensureDatastore(): Promise<void> {
  if (await gsExists(`/workspaces/${WS}/datastores/${STORE}`)) return;
  const body = {
    dataStore: {
      name: STORE,
      connectionParameters: {
        entry: [
          { '@key': 'dbtype', $: 'postgis' },
          { '@key': 'host', $: process.env.GEOSERVER_DB_HOST ?? 'db' },
          { '@key': 'port', $: process.env.GEOSERVER_DB_PORT ?? '5432' },
          { '@key': 'database', $: process.env.GEOSERVER_DB_NAME ?? 'webatlas' },
          { '@key': 'schema', $: 'water' },
          { '@key': 'user', $: process.env.GEOSERVER_DB_USER ?? 'webatlas' },
          { '@key': 'passwd', $: process.env.GEOSERVER_DB_PASSWORD ?? '' },
          { '@key': 'Expose primary keys', $: 'true' },
        ],
      },
    },
  };
  const res = await gsRequest('POST', `/workspaces/${WS}/datastores`, body);
  if (!res.ok) throw new Error(`create datastore failed: ${res.status} ${await res.text()}`);
}

/**
 * Publish `table` as a featuretype whose public name is the bare layer key
 * (webatlas:dams, …) but whose backing relation is the `<layer>_active` view,
 * so the served data follows the active-version pointer: when an edit session
 * commits or a new ingest lands, WFS consumers see it with no republish.
 *
 * Existing featuretypes are repointed with a PUT rather than delete-and-recreate:
 * a delete would drop the published layer's styling and other configuration,
 * which is not recoverable from this repo. The PUT is a no-op once nativeName
 * already matches, so publishAll() stays safe to run repeatedly.
 */
async function ensureLayer(table: string): Promise<void> {
  const ftPath = `/workspaces/${WS}/datastores/${STORE}/featuretypes`;
  const view = nativeNameFor(table);

  const existing = await gsRequest('GET', `${ftPath}/${table}`);
  if (existing.status === 200) {
    const current = (await existing.json()) as { featureType?: { nativeName?: string } };
    if (current.featureType?.nativeName === view) return;
    // Repoint an install published before the active-version views existed.
    const res = await gsRequest('PUT', `${ftPath}/${table}`, {
      featureType: { name: table, nativeName: view },
    });
    if (!res.ok) throw new Error(`repoint ${table} failed: ${res.status} ${await res.text()}`);
    return;
  }

  const body = {
    featureType: {
      name: table,
      nativeName: view,
      srs: 'EPSG:4326',
      enabled: true,
    },
  };
  const res = await gsRequest('POST', ftPath, body);
  if (!res.ok) throw new Error(`publish ${table} failed: ${res.status} ${await res.text()}`);
}

export async function publishAll(): Promise<void> {
  await ensureWorkspace();
  await ensureDatastore();
  for (const t of TABLES) {
    await ensureLayer(t);
    // eslint-disable-next-line no-console
    console.log(`published layer ${WS}:${t}`);
  }
}

// Run when invoked directly (npm run publish:geoserver), not when imported.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  publishAll().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}

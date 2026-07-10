import 'dotenv/config';
import { gsRequest, gsExists } from './client';

const WS = process.env.GEOSERVER_WORKSPACE ?? 'webatlas';
const STORE = `${WS}_water`;
const TABLES = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

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

async function ensureLayer(table: string): Promise<void> {
  const ftPath = `/workspaces/${WS}/datastores/${STORE}/featuretypes`;
  if (await gsExists(`${ftPath}/${table}`)) return;
  const body = {
    featureType: {
      name: table,
      nativeName: table,
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

publishAll().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

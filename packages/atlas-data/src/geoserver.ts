/**
 * GeoServer REST, ported from apps/api/src/geoserver/{client,publish}.ts (spec §8). A deliberate,
 * temporary duplicate: the API's publish script keeps working until Plan C removes it (NFR-7), and
 * a package must not import an app. Unlike the original, every call takes its environment and fetch
 * explicitly, so it is testable without a GeoServer.
 */
export interface GeoServerEnv {
  url: string;
  user: string;
  password: string;
  workspace: string;
  db: { host: string; port: string; name: string; user: string; password: string };
}

export function geoserverEnv(env: NodeJS.ProcessEnv = process.env): GeoServerEnv {
  const url = env.GEOSERVER_URL;
  if (!url) throw new Error('GEOSERVER_URL is not set');
  return {
    url: url.replace(/\/$/, ''),
    user: env.GEOSERVER_ADMIN_USER ?? 'admin',
    password: env.GEOSERVER_ADMIN_PASSWORD ?? '',
    workspace: env.GEOSERVER_WORKSPACE ?? 'webatlas',
    db: {
      // GeoServer reaches Postgres over the compose network, hence `db`, not localhost.
      host: env.GEOSERVER_DB_HOST ?? 'db',
      port: env.GEOSERVER_DB_PORT ?? '5432',
      name: env.GEOSERVER_DB_NAME ?? 'webatlas',
      user: env.GEOSERVER_DB_USER ?? 'webatlas',
      password: env.GEOSERVER_DB_PASSWORD ?? '',
    },
  };
}

type Method = 'GET' | 'POST' | 'PUT';

async function gsRequest(gs: GeoServerEnv, f: typeof fetch, method: Method, path: string, body?: unknown): Promise<Response> {
  return f(`${gs.url}/rest${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64'),
      // GeoServer content-negotiates and defaults to HTML without an explicit Accept.
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Any non-2xx fails the stage (spec §8), with the status, the path, and GeoServer's own text. */
async function expectOk(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`GeoServer ${what} failed: ${res.status} ${await res.text()}`);
}

export async function publishLayer(
  gs: GeoServerEnv,
  spec: { layer: string; nativeName?: string; style?: string },
  f: typeof fetch = fetch
): Promise<'created' | 'repointed' | 'unchanged'> {
  const ws = gs.workspace;
  const store = `${ws}_water`;
  const native = spec.nativeName ?? `${spec.layer}_active`;

  if ((await gsRequest(gs, f, 'GET', `/workspaces/${ws}`)).status !== 200) {
    await expectOk(await gsRequest(gs, f, 'POST', '/workspaces', { workspace: { name: ws } }), `create workspace ${ws}`);
  }
  if ((await gsRequest(gs, f, 'GET', `/workspaces/${ws}/datastores/${store}`)).status !== 200) {
    const entry = [
      { '@key': 'dbtype', $: 'postgis' },
      { '@key': 'host', $: gs.db.host },
      { '@key': 'port', $: gs.db.port },
      { '@key': 'database', $: gs.db.name },
      { '@key': 'schema', $: 'water' },
      { '@key': 'user', $: gs.db.user },
      { '@key': 'passwd', $: gs.db.password },
      { '@key': 'Expose primary keys', $: 'true' },
    ];
    await expectOk(
      await gsRequest(gs, f, 'POST', `/workspaces/${ws}/datastores`, { dataStore: { name: store, connectionParameters: { entry } } }),
      `create datastore ${store}`
    );
  }

  const ftPath = `/workspaces/${ws}/datastores/${store}/featuretypes`;
  let outcome: 'created' | 'repointed' | 'unchanged';
  const existing = await gsRequest(gs, f, 'GET', `${ftPath}/${spec.layer}`);
  if (existing.status === 200) {
    const current = (await existing.json()) as { featureType?: { nativeName?: string } };
    if (current.featureType?.nativeName === native) {
      outcome = 'unchanged';
    } else {
      // PUT, never delete-and-recreate: a delete drops the layer's styling, which this repo
      // cannot restore.
      await expectOk(
        await gsRequest(gs, f, 'PUT', `${ftPath}/${spec.layer}`, { featureType: { name: spec.layer, nativeName: native } }),
        `repoint ${spec.layer}`
      );
      outcome = 'repointed';
    }
  } else {
    await expectOk(
      await gsRequest(gs, f, 'POST', ftPath, {
        featureType: { name: spec.layer, nativeName: native, srs: 'EPSG:4326', enabled: true },
      }),
      `publish ${spec.layer}`
    );
    outcome = 'created';
  }

  if (spec.style) {
    await expectOk(
      await gsRequest(gs, f, 'PUT', `/layers/${ws}:${spec.layer}`, { layer: { defaultStyle: { name: spec.style } } }),
      `style ${spec.layer}`
    );
  }
  if (outcome === 'repointed') {
    // Repointing does not refresh GeoServer's cached attribute schema until the catalog resets.
    await expectOk(await gsRequest(gs, f, 'POST', '/reset'), 'catalog reset');
  }
  return outcome;
}

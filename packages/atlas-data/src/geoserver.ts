/**
 * GeoServer REST for the publish stages (spec §8). The only publisher: the API's own publish
 * script went with Plan C, and what remains in apps/api/src/geoserver/client.ts is the read-only
 * client its tests use. Every call takes its environment and fetch explicitly, so it is testable
 * without a GeoServer.
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

/** Every REST call is bounded: a hung GeoServer must fail the stage, not the whole build. */
const REQUEST_TIMEOUT_MS = 60_000;

async function gsRequest(gs: GeoServerEnv, f: typeof fetch, method: Method, path: string, body?: unknown): Promise<Response> {
  try {
    const res = await gsFetch(gs, f, method, path, body);
    calls.set(res, `${method} ${path}`);
    return res;
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`GeoServer ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, { cause: err });
    }
    throw err;
  }
}

/** Body reads share the request timeout signal; name the call when one fires mid-body. */
const calls = new WeakMap<Response, string>();

async function readBody<T>(res: Response, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`GeoServer ${calls.get(res) ?? 'request'} timed out after ${REQUEST_TIMEOUT_MS / 1000} s`, { cause: err });
    }
    throw err;
  }
}

function gsFetch(gs: GeoServerEnv, f: typeof fetch, method: Method, path: string, body?: unknown): Promise<Response> {
  return f(`${gs.url}/rest${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  if (!res.ok) throw new Error(`GeoServer ${what} failed: ${res.status} ${await readBody(res, () => res.text())}`);
  await res.body?.cancel(); // success bodies are unused; release the connection
}

export function defaultNativeName(layer: string): string {
  return `${layer}_active`;
}

/** Existence probe: 200 present, 404 missing, anything else fails the stage (spec §8). */
async function exists(gs: GeoServerEnv, f: typeof fetch, path: string, what: string): Promise<Response | null> {
  const res = await gsRequest(gs, f, 'GET', path);
  if (res.status === 200) return res;
  if (res.status === 404) {
    await res.body?.cancel(); // unused body: release the connection
    return null;
  }
  throw new Error(`GeoServer check ${what} failed: ${res.status} ${await readBody(res, () => res.text())}`);
}

/** Existence probe whose 200 body is not needed: cancel it. */
async function isPresent(gs: GeoServerEnv, f: typeof fetch, path: string, what: string): Promise<boolean> {
  const res = await exists(gs, f, path, what);
  await res?.body?.cancel();
  return res !== null;
}

export async function publishLayer(
  gs: GeoServerEnv,
  spec: { layer: string; nativeName?: string; style?: string },
  f: typeof fetch = fetch
): Promise<'created' | 'repointed' | 'unchanged'> {
  const ws = gs.workspace;
  const store = `${ws}_water`;
  const native = spec.nativeName ?? defaultNativeName(spec.layer);

  if (!(await isPresent(gs, f, `/workspaces/${ws}`, `workspace ${ws}`))) {
    await expectOk(await gsRequest(gs, f, 'POST', '/workspaces', { workspace: { name: ws } }), `create workspace ${ws}`);
  }
  if (!(await isPresent(gs, f, `/workspaces/${ws}/datastores/${store}`, `datastore ${store}`))) {
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
  const existing = await exists(gs, f, `${ftPath}/${spec.layer}`, `featuretype ${spec.layer}`);
  if (existing) {
    const current = (await readBody(existing, () => existing.json())) as { featureType?: { nativeName?: string } };
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
  // Always reset: a relation rebuilt under the same nativeName keeps a stale cached attribute
  // schema until the catalog resets (as apps/api publishAll does).
  await expectOk(await gsRequest(gs, f, 'POST', '/reset'), 'catalog reset');
  return outcome;
}

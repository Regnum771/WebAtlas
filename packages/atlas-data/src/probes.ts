import type { Pool } from 'pg';
import type { Probe, ProbeContext, ProbeResult } from './types';
import { geoserverEnv } from './geoserver';

export const pass = (detail: string): ProbeResult => ({ ok: true, detail });
export const fail = (detail: string): ProbeResult => ({ ok: false, detail });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Checks in order; the first failure wins and nothing after it runs. A thrown check is a failure. */
export function allOf(...checks: Probe[]): Probe {
  return async (ctx) => {
    if (checks.length === 0) return fail('no checks defined');
    const details: string[] = [];
    for (const check of checks) {
      let r: ProbeResult;
      try {
        r = await check(ctx);
      } catch (err) {
        return fail(message(err));
      }
      if (!r.ok) return r;
      details.push(r.detail);
    }
    return pass(details.join('; '));
  };
}

/**
 * `sql` must return one row with a text column `n`. The SQL comes from descriptor code, never from
 * input, so it is not parameterised.
 */
export function rowCount(label: string, sql: string, min = 1): Probe {
  return async ({ pool }) => {
    try {
      const { rows } = await pool.query<{ n: string }>(sql);
      const n = Number(rows[0]?.n ?? 0);
      return n >= min ? pass(`${label}: ${n}`) : fail(`${label}: ${n} (expected ≥ ${min})`);
    } catch (err) {
      return fail(`${label}: ${message(err)}`);
    }
  };
}

/** Rows visible through a versioned layer's `<layer>_active` view. */
export const viewCount = (layer: string): Probe => {
  if (!/^[a-z_][a-z0-9_]*$/.test(layer)) throw new Error(`viewCount: invalid layer name "${layer}"`);
  return rowCount(`water.${layer}_active`, `SELECT count(*)::text AS n FROM water.${layer}_active`);
};

export function wfsAnswers(layer: string): Probe {
  return async ({ geoserver }) => {
   try {
    const res = await geoserver(
      `/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:${layer}&outputFormat=application/json&count=1`
    );
    if (res.status !== 200) {
      await res.body?.cancel();
      return fail(`webatlas:${layer} WFS ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { features?: unknown[] } | null;
    return (body?.features?.length ?? 0) > 0
      ? pass(`webatlas:${layer} serves WFS`)
      : fail(`webatlas:${layer} WFS returned no features`);
   } catch (err) {
    return fail(`webatlas:${layer} WFS: ${message(err)}`);
   }
  };
}

/** A missing WMS layer answers 200 with an XML ServiceException (measured), so the check is the PNG type. */
export function wmsAnswers(layer: string, bbox: string): Probe {
  return async ({ geoserver }) => {
   try {
    const res = await geoserver(
      `/wms?service=WMS&version=1.1.1&request=GetMap&layers=webatlas:${layer}&styles=&bbox=${bbox}` +
        `&width=64&height=64&srs=EPSG:4326&format=image/png`
    );
    const type = res.headers.get('content-type') ?? '';
    await res.body?.cancel();
    return res.status === 200 && type.startsWith('image/png')
      ? pass(`webatlas:${layer} renders`)
      : fail(`webatlas:${layer} WMS ${res.status} ${type}`);
   } catch (err) {
    return fail(`webatlas:${layer} WMS: ${message(err)}`);
   }
  };
}

export function elevationBetween(label: string, lon: number, lat: number, min: number, max: number): Probe {
  return async ({ pool }) => {
    try {
      const { rows } = await pool.query<{ v: string | null }>(
        `SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint($1, $2), 4326))::text AS v
           FROM basemap.dem_region
          WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1`,
        [lon, lat]
      );
      const raw = rows[0]?.v ?? null;
      if (raw === null) return fail(`${label}: no elevation (DEM not loaded there)`);
      const v = Number(raw);
      return v >= min && v <= max
        ? pass(`${label}: ${Math.round(v)} m`)
        : fail(`${label}: ${Math.round(v)} m (expected ${min}–${max})`);
    } catch (err) {
      return fail(`${label}: ${message(err)}`);
    }
  };
}

/** The live context: the pool, and authenticated GETs against GEOSERVER_URL with a 60 s timeout. */
export function probeContext(pool: Pool, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): ProbeContext {
  return {
    pool,
    geoserver: async (path) => {
      const gs = geoserverEnv(env);
      return f(`${gs.url}${path}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64') },
        signal: AbortSignal.timeout(60_000),
      });
    },
  };
}

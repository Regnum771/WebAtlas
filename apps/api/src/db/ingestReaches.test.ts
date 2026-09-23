import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

describe('HydroRIVERS reach ingest', () => {
  it('loads reaches and ways into ONE active version', async () => {
    const { rows } = await getPool().query<{ lvl: string; n: string; versions: string }>(
      `SELECT feature_level::text AS lvl, count(*)::text AS n,
              count(DISTINCT dataset_version_id)::text AS versions
         FROM water.rivers_active GROUP BY feature_level ORDER BY feature_level`
    );
    const byLevel = Object.fromEntries(rows.map((r) => [r.lvl, r]));
    expect(byLevel['2'].n).toBe('13045');
    expect(byLevel['3'].n).toBe('9486');
    // Both levels in the same version: an ingest version has no parent, so two
    // versions here would mean one level is invisible to rivers_active.
    expect(new Set(rows.map((r) => r.versions))).toEqual(new Set(['1']));
  });

  it('prefixes every reach id and never collides with an OSM way id', async () => {
    const { rows } = await getPool().query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM water.rivers_active
        WHERE (feature_level = 2 AND external_id !~ '^hyriv:[0-9]+$')
           OR (feature_level = 3 AND external_id !~ '^osm:[0-9]+$')`
    );
    expect(rows[0].bad).toBe('0');
  });

  it('carries NEXT_DOWN as flows_into, NULL only for a true terminal', async () => {
    const { rows } = await getPool().query<{ total: string; nulls: string; dangling: string }>(
      `WITH r AS (SELECT external_id, flows_into_external_id FROM water.rivers_active WHERE feature_level = 2)
       SELECT count(*)::text AS total,
              count(*) FILTER (WHERE flows_into_external_id IS NULL)::text AS nulls,
              count(*) FILTER (WHERE flows_into_external_id IS NOT NULL
                                 AND NOT EXISTS (SELECT 1 FROM r d
                                                  WHERE d.external_id = r.flows_into_external_id))::text AS dangling
         FROM r`
    );
    expect(rows[0].total).toBe('13045');
    // 184 terminal reaches (NEXT_DOWN = 0). Measured.
    expect(rows[0].nulls).toBe('184');
    // 53 reaches flow OUT of the six provinces. Their link is kept rather than nulled:
    // "water goes to a reach this dataset does not hold" is a different fact from
    // "this is the end of the network", and the gates must tell them apart.
    expect(rows[0].dangling).toBe('53');
  });

  it('gives level 2 the true Strahler order and leaves reaches unnamed', async () => {
    const { rows } = await getPool().query<{ lo: string; hi: string; named: string }>(
      `SELECT min(stream_order)::text AS lo, max(stream_order)::text AS hi,
              count(*) FILTER (WHERE name IS NOT NULL)::text AS named
         FROM water.rivers_active WHERE feature_level = 2`
    );
    expect(rows[0].lo).toBe('1');
    expect(rows[0].hi).toBe('6');
    // HydroRIVERS has no names. Any name here would be invented.
    expect(rows[0].named).toBe('0');
  });
});

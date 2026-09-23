import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { MATCH_MIN_VOTES, MATCH_SAMPLES, BRIDGED_CONFIDENCE } from './riverHierarchy';

afterAll(async () => { await closePool(); });

describe('reach name join', () => {
  it('names the reaches the measured baseline says it should', async () => {
    // parent_external_id on a level-2 row holds a RIVER ID after Task 6's build, not the
    // voted name -- buildLevelOne rewrites it once connectivity has grouped reaches into
    // level-1 rivers. To keep pinning the VOTE itself (not the grouping, which Task 6's
    // bridging step also feeds into via the same column), read the name back through the
    // level-1 join, and restrict to voted rows (match_confidence >= 0.3): a bridged reach
    // also ends up with a river id here, but its confidence is BRIDGED_CONFIDENCE (0.2),
    // below the vote's floor, so this excludes it and keeps the 4,716/439 pins exactly
    // what they were before bridging existed.
    const { rows } = await getPool().query<{ matched: string; names: string }>(
      `SELECT count(*)::text AS matched, count(DISTINCT p.name)::text AS names
         FROM water.rivers_active c
         JOIN water.rivers_active p ON p.external_id = c.parent_external_id AND p.feature_level = 1
        WHERE c.feature_level = 2 AND c.match_confidence >= 0.3`
    );
    // Baseline pinned from the first real run (spec §2): 4,716 of 13,045 reaches,
    // carrying 439 of the 466 distinct OSM names. A LOWER number is a regression the
    // gate in Task 6 must refuse; a different number at all means the algorithm or the
    // data changed -- report it, do not edit these figures.
    expect(Number(rows[0].matched)).toBe(4716);
    expect(Number(rows[0].names)).toBe(439);
  });

  it('records a confidence for every match and none for a non-match', async () => {
    // Voted matches land in [0.3, 1.0] (assignReachNames); bridged reaches (Task 6, the
    // 2026-09-23 decision) are a separate mechanism and must land at EXACTLY
    // BRIDGED_CONFIDENCE, deliberately below that floor so the two are distinguishable.
    // "out_of_range" catches anything that is neither -- a value this test must never
    // silently accept by loosening the [0.3,1] bound.
    const { rows } = await getPool().query<{ bad: string; lo: string; hi: string; outOfRange: string }>(
      `SELECT count(*) FILTER (
                WHERE (parent_external_id IS NULL) <> (match_confidence IS NULL))::text AS bad,
              min(match_confidence) FILTER (WHERE match_confidence <> $1)::text AS lo,
              max(match_confidence) FILTER (WHERE match_confidence <> $1)::text AS hi,
              count(*) FILTER (
                WHERE match_confidence IS NOT NULL AND match_confidence <> $1
                  AND match_confidence NOT BETWEEN 0.3 AND 1)::text AS "outOfRange"
         FROM water.rivers_active WHERE feature_level = 2`,
      [BRIDGED_CONFIDENCE]
    );
    // A match without a confidence is a silent assertion; a confidence without a match
    // is meaningless. They travel together.
    expect(rows[0].bad).toBe('0');
    expect(rows[0].outOfRange).toBe('0');
    expect(Number(rows[0].lo)).toBeGreaterThanOrEqual(0.3);
    expect(Number(rows[0].hi)).toBeLessThanOrEqual(1);
  });

  it('assigns the real Sông Ba its measured reach count', async () => {
    // Same rebinding as the test above: read the name through the level-1 join, and
    // restrict to voted (non-bridged) reaches, so this keeps pinning the vote's own
    // count, unaffected by whether any of Sông Ba's gaps got bridged.
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active c
         JOIN water.rivers_active p ON p.external_id = c.parent_external_id AND p.feature_level = 1
        WHERE c.feature_level = 2 AND c.match_confidence >= 0.3 AND p.name = 'Sông Ba'`
    );
    // Measured: 131 reaches, ~352 km. The longest river in the working region, so it
    // exercises the vote over a long chain rather than a single reach.
    expect(rows[0].n).toBe('131');
  });

  it('leaves unmatched reaches visibly unmatched', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id IS NULL`
    );
    // The vote refuses 8,329 reaches; bridging then names the 38 single-reach gaps
    // whose upstream and downstream carry the same name, leaving 8,291 -- mostly
    // headwater reaches HydroRIVERS maps and OSM has not named. They stay unnamed and
    // walkable, never attached to a river the data does not claim.
    expect(rows[0].n).toBe('8291');
  });

  it('needs a real majority, not a plurality of one', () => {
    expect(MATCH_MIN_VOTES).toBeGreaterThan(MATCH_SAMPLES / 2);
  });
});

describe('level-1 rivers', () => {
  it('emits one river per name plus connected group', async () => {
    const { rows } = await getPool().query<{ rivers: string; names: string }>(
      `SELECT count(*)::text AS rivers, count(DISTINCT name)::text AS names
         FROM water.rivers_active WHERE feature_level = 1`
    );
    // 588 rivers from 439 names (re-pinned 2026-09-23 after same-name gap bridging
    // dropped this from 631: bridging merges some of the previously-disjoint same-name
    // groups this count used to include, Sông Thu Bồn's two fragments among them).
    // MORE rivers than names is still CORRECT and must not be "fixed": 93 names still
    // sit on more than one disconnected group (down from 109 pre-bridging). Sông Cái --
    // literally "main river" -- is now 12 genuinely different rivers (down from 15), the
    // same phenomenon as Phase 2's 147 separate Thôn 3.
    expect(rows[0].rivers).toBe('588');
    expect(rows[0].names).toBe('439');
  });

  it('gives every river a stable derived id and a real name', async () => {
    const { rows } = await getPool().query<{ bad: string; nameless: string }>(
      `SELECT count(*) FILTER (WHERE external_id !~ '^river:[0-9]+$')::text AS bad,
              count(*) FILTER (WHERE name IS NULL)::text AS nameless
         FROM water.rivers_active WHERE feature_level = 1`
    );
    expect(rows[0].bad).toBe('0');
    // Per the 2026-09-22 decision: no nameless level-1 rows at all. An unnamed reach
    // stays a level-2 row rather than becoming an unselectable entity.
    expect(rows[0].nameless).toBe('0');
  });

  it('gives every river geometry and the max Strahler order of its reaches', async () => {
    const { rows } = await getPool().query<{ nogeom: string; mismatched: string }>(
      `WITH members AS (
         SELECT p.external_id, max(c.stream_order) AS max_order
           FROM water.rivers_active p
           JOIN water.rivers_active c ON c.parent_external_id = p.external_id AND c.feature_level = 2
          WHERE p.feature_level = 1 GROUP BY p.external_id)
       SELECT count(*) FILTER (WHERE p.geom IS NULL)::text AS nogeom,
              count(*) FILTER (WHERE p.stream_order <> m.max_order)::text AS mismatched
         FROM water.rivers_active p JOIN members m ON m.external_id = p.external_id
        WHERE p.feature_level = 1`
    );
    // geom is NOT NULL on water.rivers, so a river with no derivable geometry would
    // have failed the insert -- this asserts the fallback actually fires.
    expect(rows[0].nogeom).toBe('0');
    expect(rows[0].mismatched).toBe('0');
  });

  it('resolves Sông Thu Bồn to ONE searchable river', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 1 AND name = 'Sông Thu Bồn'`
    );
    // The defect in the spec's opening paragraph: searching "thu" returned two hits both
    // called Sông Thu Bồn, and picking one gave an arbitrary fragment.
    expect(rows[0].n).toBe('1');
  });

  it('points every reach at a river that exists', async () => {
    const { rows } = await getPool().query<{ orphan: string }>(
      `SELECT count(*)::text AS orphan FROM water.rivers_active c
        WHERE c.feature_level = 2 AND c.parent_external_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM water.rivers_active p
                           WHERE p.external_id = c.parent_external_id AND p.feature_level = 1)`
    );
    // Task 5 parks the NAME here; if Task 6 failed to replace it with a river id this is
    // 4,716 rather than 0.
    expect(rows[0].orphan).toBe('0');
  });
});

describe('same-name gap bridging', () => {
  it('folds hyriv:41295432 into the same river as its Thu Bồn neighbours', async () => {
    // The measured case from the 2026-09-23 decision: this reach's own vote found "Sông
    // Thu Bồn" too (3 of 5 samples), just not strongly enough to clear the median-distance
    // cutoff, and being unnamed severed the 38-reach main group from its own outlet.
    const { rows } = await getPool().query<{ river: string; name: string; conf: string }>(
      `SELECT c.parent_external_id AS river, p.name, c.match_confidence::text AS conf
         FROM water.rivers_active c
         JOIN water.rivers_active p ON p.external_id = c.parent_external_id AND p.feature_level = 1
        WHERE c.feature_level = 2 AND c.external_id = 'hyriv:41295432'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Sông Thu Bồn');
    expect(Number(rows[0].conf)).toBe(BRIDGED_CONFIDENCE);

    const { rows: neighbours } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM water.rivers_active g
         JOIN water.rivers_active d ON d.external_id = g.flows_into_external_id
        WHERE g.external_id = 'hyriv:41295432' AND d.parent_external_id = $1`,
      [rows[0].river]
    );
    // hyriv:41295432's downstream neighbour (hyriv:41295269, the terminal outlet) must
    // land in the SAME river, which is exactly what bridging existed to fix.
    expect(neighbours[0].n).toBe('1');
  });

  it("gives every bridged reach its downstream river and at least one matching upstream neighbour", async () => {
    const { rows } = await getPool().query<{ mismatchedDown: string; noMatchingUp: string }>(
      `WITH bridged AS (
         SELECT c.external_id, c.parent_external_id AS river, c.flows_into_external_id
           FROM water.rivers_active c
          WHERE c.feature_level = 2 AND c.match_confidence = $1
       )
       SELECT
         count(*) FILTER (WHERE d.parent_external_id IS DISTINCT FROM b.river)::text AS "mismatchedDown",
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1 FROM water.rivers_active u
              WHERE u.feature_level = 2 AND u.flows_into_external_id = b.external_id
                AND u.parent_external_id = b.river
           )
         )::text AS "noMatchingUp"
         FROM bridged b JOIN water.rivers_active d ON d.external_id = b.flows_into_external_id`,
      [BRIDGED_CONFIDENCE]
    );
    expect(rows[0].mismatchedDown).toBe('0');
    expect(rows[0].noMatchingUp).toBe('0');
  });

  it('never bridges two adjacent reaches (no cascading)', async () => {
    // A bridge requires its downstream/upstream justifier to carry a VOTED name in the
    // pre-bridge snapshot -- a gap by definition has none -- so no two bridged reaches
    // should ever be adjacent, in either flow direction.
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM water.rivers_active a
         JOIN water.rivers_active b
           ON (b.external_id = a.flows_into_external_id OR a.external_id = b.flows_into_external_id)
        WHERE a.feature_level = 2 AND a.match_confidence = $1
          AND b.feature_level = 2 AND b.match_confidence = $1
          AND a.external_id <> b.external_id`,
      [BRIDGED_CONFIDENCE]
    );
    expect(rows[0].n).toBe('0');
  });
});

describe('activation gates', () => {
  it('finds no cycle and no Strahler decrease in the shipped network', async () => {
    const { rows } = await getPool().query<{ decreasing: string }>(
      `SELECT count(*)::text AS decreasing
         FROM water.rivers_active u
         JOIN water.rivers_active d ON d.external_id = u.flows_into_external_id
        WHERE u.feature_level = 2 AND d.feature_level = 2
          AND d.stream_order < u.stream_order`
    );
    // Verified against the raw shapefile before this plan was written: 0 violations and
    // 0 cycles in the 13,045-reach selection. A nonzero count means the ingest mangled
    // the links, not that HydroRIVERS is wrong.
    expect(rows[0].decreasing).toBe('0');
  });

  it('gives every river at least one reach', async () => {
    const { rows } = await getPool().query<{ childless: string }>(
      `SELECT count(*)::text AS childless FROM water.rivers_active p
        WHERE p.feature_level = 1
          AND NOT EXISTS (SELECT 1 FROM water.rivers_active c
                           WHERE c.parent_external_id = p.external_id AND c.feature_level = 2)`
    );
    expect(rows[0].childless).toBe('0');
  });

  it('refuses a version that regresses below the pinned match rate', async () => {
    const { assertRiverGates, RIVER_BASELINE } = await import('./riverGates');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
      );
      // Unname a third of the reaches inside a transaction that is rolled back.
      await client.query(
        `UPDATE water.rivers SET parent_external_id = NULL, match_confidence = NULL
          WHERE dataset_version_id = $1 AND feature_level = 2
            AND external_id IN (SELECT external_id FROM water.rivers
                                 WHERE dataset_version_id = $1 AND feature_level = 2
                                   AND parent_external_id IS NOT NULL LIMIT 1600)`,
        [rows[0].id]
      );
      await expect(assertRiverGates(client, rows[0].id, RIVER_BASELINE)).rejects.toThrow(/match rate/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // The gate evaluates EVERY check before reporting, including the network-wide
    // cycle/Strahler walk (~15 s on its own), so this runs well past the 30 s default
    // when it follows the other gate tests. Measured 12 s in isolation.
  }, 120_000);
});

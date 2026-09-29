import type { PoolClient } from 'pg';

/**
 * Pinned per spec §2 so a later re-ingest cannot silently regress. Re-measured 2026-09-23
 * against HydroRIVERS v10 and the committed OSM waterways, via the rollback-only
 * `npm run rivers:hierarchy` CLI against the (then-)active version, run twice with
 * byte-identical output, AFTER adding same-name gap bridging (the 2026-09-23 decision,
 * reversing the plan's original Deviation 4).
 *
 * `reaches` counts every level-2 reach that ends up with a river -- voted (4,716) PLUS
 * bridged (38) = 4,754 -- because that is exactly what assertRiverGates's own `reaches`
 * check counts (`parent_external_id IS NOT NULL` on a level-2 row, read AFTER buildLevelOne
 * has rewritten it from name to river id; a bridged reach gets a river id here exactly the
 * same way a voted one does). `names` (439) is unchanged by bridging: bridging never
 * invents a new name, only extends an existing one across a gap. `rivers` DROPS from the
 * prior baseline of 631 to 588: bridging merges previously-disjoint same-name groups (Thu
 * Bồn's 2 fragments become 1, among others), and a single bridged reach at a confluence can
 * merge more than 2 groups at once if several same-named upstream branches all fed that one
 * gap point -- so 38 bridged reaches produced 43 fewer rivers (631 - 588), not 38 fewer.
 * Verified this is not a bug: an independent SQL query against the pre-bridging active
 * version found exactly the same 38 gaps by the same rule, and the two Sông Thu Bồn rivers
 * confirmed adjacent (ST_Distance 0) are the ones that merged.
 *
 * Raising these is a deliberate act; a build that falls below them does not activate.
 */
export const RIVER_BASELINE = { reaches: 4754, names: 439, rivers: 588 } as const;

export type RiverBaseline = typeof RIVER_BASELINE;

/**
 * Spec §2's activation gates, as assertions over ONE version's own rows. Called from
 * inside the ingest transaction before activate(), so throwing aborts the version.
 *
 * "No reach with two parents" is structural rather than checked: parent_external_id is a
 * single column, so a reach cannot hold two composition parents, and NEXT_DOWN gives one
 * outgoing flow link. A reach legitimately RECEIVES up to 4 (measured) -- that is a
 * confluence, not a defect, so nothing here counts incoming links.
 */
export async function assertRiverGates(
  client: PoolClient,
  versionId: string,
  baseline: RiverBaseline
): Promise<void> {
  const { rows } = await client.query<Record<string, string>>(
    `WITH v AS (SELECT * FROM water.rivers WHERE dataset_version_id = $1 AND NOT deleted)
     SELECT
       (SELECT count(*) FROM v WHERE feature_level = 2 AND parent_external_id IS NOT NULL)::text AS reaches,
       (SELECT count(DISTINCT name) FROM v WHERE feature_level = 1)::text AS names,
       (SELECT count(*) FROM v WHERE feature_level = 1)::text AS rivers,
       (SELECT count(*) FROM v u JOIN v d ON d.external_id = u.flows_into_external_id
         WHERE u.feature_level = 2 AND d.feature_level = 2
           AND d.stream_order < u.stream_order)::text AS decreasing,
       (SELECT count(*) FROM v p WHERE p.feature_level = 1
          AND NOT EXISTS (SELECT 1 FROM v c
                           WHERE c.parent_external_id = p.external_id AND c.feature_level = 2))::text AS childless,
       (SELECT count(*) FROM v c WHERE c.parent_external_id IS NOT NULL AND c.feature_level IN (2, 3)
          AND NOT EXISTS (SELECT 1 FROM v p
                           WHERE p.external_id = c.parent_external_id AND p.feature_level = 1))::text AS orphaned
      `,
    [versionId]
  );
  const r = rows[0];
  // Collect every violation and throw ONCE, rather than stopping at the first: a single
  // root cause (e.g. a bad UPDATE that nulls out a swath of parent links) typically trips
  // several checks at once (childless rivers AND a match-rate regression, say), and a
  // human deciding whether to re-run or roll further back needs the whole picture in one
  // error, not a game of fix-one-rerun-see-the-next.
  const failures: string[] = [];

  if (Number(r.decreasing) > 0) {
    failures.push(`Strahler order decreases downstream on ${r.decreasing} reach pairs`);
  }
  if (Number(r.childless) > 0) {
    failures.push(`${r.childless} level-1 rivers have no reach`);
  }
  if (Number(r.orphaned) > 0) {
    failures.push(`${r.orphaned} rows point at a parent that is not a level-1 river`);
  }
  // Cycles: walk UPSTREAM from every outlet (a reach whose flows_into is NULL or leaves
  // the version) and count the reaches never reached. flows_into gives each reach at most
  // one outgoing link, so each reach is reached at most once, along its unique downstream
  // path -- the walk is O(reaches), always terminates, and never enters a cycle, because
  // no member of a cycle (or anything draining into one) has a path to an outlet. So the
  // unreached count is exactly the reaches on or upstream of a cycle; 0 means acyclic.
  // (The previous version walked downstream from every reach with a 20,000-hop bound,
  // which on cyclic input meant up to 20,000 hops per reach before it could report.)
  const cyc = await client.query<{ stuck: string }>(
    `WITH RECURSIVE v AS (
       SELECT external_id, flows_into_external_id FROM water.rivers
        WHERE dataset_version_id = $1 AND feature_level = 2 AND NOT deleted
     ),
     reached AS (
       SELECT o.external_id FROM v o
        WHERE o.flows_into_external_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM v d WHERE d.external_id = o.flows_into_external_id)
       UNION ALL
       SELECT u.external_id FROM reached r JOIN v u ON u.flows_into_external_id = r.external_id
     )
     SELECT ((SELECT count(*) FROM v) - (SELECT count(*) FROM reached))::text AS stuck`,
    [versionId]
  );
  if (Number(cyc.rows[0].stuck) > 0) {
    failures.push(
      `flows_into contains a cycle (${cyc.rows[0].stuck} reaches lie on or drain into it)`
    );
  }
  if (Number(r.reaches) < baseline.reaches) {
    failures.push(`match rate regressed: ${r.reaches} named reaches, baseline ${baseline.reaches}`);
  }
  if (Number(r.names) < baseline.names) {
    failures.push(`match rate regressed: ${r.names} distinct river names, baseline ${baseline.names}`);
  }
  if (Number(r.rivers) < baseline.rivers) {
    failures.push(`match rate regressed: ${r.rivers} level-1 rivers, baseline ${baseline.rivers}`);
  }

  if (failures.length > 0) {
    throw new Error(`river hierarchy gate failed: ${failures.join('; ')}`);
  }
}

import type { PoolClient } from 'pg';

/** Sample points per reach, at 0.1, 0.3, 0.5, 0.7, 0.9 along its length. */
export const MATCH_SAMPLES = 5;
/** A strict majority of MATCH_SAMPLES. A plurality would let a 2-2-1 split decide. */
export const MATCH_MIN_VOTES = 3;
/** ST_DWithin prefilter, in degrees. ~1.1 km at this latitude. */
export const MATCH_TOLERANCE_DEG = 0.01;
/** Median sample-to-way distance above which a majority is still refused. */
export const MATCH_MAX_MEDIAN_M = 500;
/**
 * Size of the nearest-candidate window the tie-break (external_id) is applied to,
 * per sample point. It bounds how many ways tied at the exact minimum KNN distance
 * the tie-break can see: an (N+1)-th tied candidate outside the window would make
 * the result scan-order dependent again -- exactly the bug this whole mechanism
 * exists to remove (see assignReachNames). It can't be raised by appending
 * external_id straight onto the KNN ORDER BY instead -- measured 2026-09-23, that
 * forces a full sort per sample point and takes the build from ~10s to >120s.
 * res_named_ways holds 1,327 distinct geometries with zero duplicates, so an exact
 * tie needs two *different* geometries at bit-identical distance from a sample
 * point -- rare (one such pair is already known to exist: it moved the matched
 * count from 4,715 to 4,716). 32 gives an 8x margin over the previous, unverified
 * value of 4, at negligible cost: the window is still drawn via the index's native
 * KNN traversal, and 32 rows is ~2% of the whole named-ways table.
 */
export const MATCH_KNN_WINDOW = 32;

/**
 * Resolve `versionId`'s chain into temp tables for the rest of the build.
 *
 * Why temp tables and not water.rivers_active: the view's WITH RECURSIVE + DISTINCT ON
 * pipeline is an optimizer fence, so no predicate reaches the index underneath it.
 * Measured 2026-09-22: the name join below timed out past 120s against the view and
 * took 10.9s against these tables. Same reasoning, same fix as search's repository.
 *
 * Resolution is keyed on the GIVEN version's ancestor chain, not on the active pointer,
 * so this works unchanged inside an ingest transaction (an ingest version has no parent,
 * so the chain is itself) and inside an edit-draft commit (draft -> parent -> ...).
 */
export async function materialiseResolved(client: PoolClient, versionId: string): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS res_rivers, res_named_ways`);
  await client.query(
    `CREATE TEMP TABLE res_rivers AS
     WITH RECURSIVE chain AS (
       SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = $1
       UNION ALL
       SELECT p.id, p.parent_version_id, c.depth + 1
         FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
     ),
     resolved AS (
       SELECT DISTINCT ON (t.external_id) t.*
         FROM water.rivers t JOIN chain c ON t.dataset_version_id = c.id
         ORDER BY t.external_id, c.depth
     )
     -- Every column Task 7's supersede step copies onto a new row, not just the ones the
     -- vote reads: a superseding row must carry the feature's full current state, and
     -- re-reading water.rivers for the rest would cross the optimizer fence again.
     SELECT external_id, feature_level, name, code, stream_order, length_m,
            parent_external_id, flows_into_external_id, match_confidence, geom
       FROM resolved WHERE NOT deleted`,
    [versionId]
  );
  await client.query(`CREATE INDEX ON res_rivers (external_id)`);
  await client.query(`CREATE INDEX ON res_rivers (feature_level)`);
  await client.query(`CREATE INDEX ON res_rivers USING GIST (geom)`);

  await client.query(
    `CREATE TEMP TABLE res_named_ways AS
       SELECT external_id, name, geom FROM res_rivers
        WHERE feature_level = 3 AND name IS NOT NULL AND geom IS NOT NULL`
  );
  await client.query(`CREATE INDEX ON res_named_ways USING GIST (geom)`);
  await client.query(`ANALYZE res_rivers`);
  await client.query(`ANALYZE res_named_ways`);
}

/**
 * Give each level-2 reach the name of the nearest named OSM way, by majority vote.
 *
 * parent_external_id temporarily holds the NAME. Task 6 replaces it with the id of the
 * level-1 river that name resolves to, once connectivity has split same-name groups.
 * The intermediate state never reaches an active version: the whole build runs inside
 * the ingest transaction, before activate().
 *
 * Confidence is the share of agreeing samples scaled by median distance (spec §2):
 *   (votes / MATCH_SAMPLES) * (1 - 0.5 * min(median, MAX) / MAX)
 * so an accepted match lands in [0.3, 1.0] -- a unanimous vote on top of the way scores
 * 1.0, a bare majority at the distance limit scores 0.3. Never 0, because a match that
 * was accepted is not no-confidence; a refused match stores NULL instead.
 */
export async function assignReachNames(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number }> {
  const { rows } = await client.query<{ matched: string; names: string; saturated: string }>(
    `WITH samples AS (
       SELECT r.external_id,
              ST_LineInterpolatePoint(ST_LineMerge(r.geom), (s.i * 2 - 1)::float / ($2 * 2)) AS pt
         FROM res_rivers r, generate_series(1, $2) AS s(i)
        WHERE r.feature_level = 2 AND r.geom IS NOT NULL
          AND ST_GeometryType(ST_LineMerge(r.geom)) = 'ST_LineString'
     ),
     nearest AS (
       SELECT s.external_id, w.name, w.saturated,
              ST_Distance(w.geom::geography, s.pt::geography) AS dist_m
         FROM samples s
         CROSS JOIN LATERAL (
           -- external_id tie-breaks two equidistant ways: without it, the KNN
           -- distance alone is not a total order and PostgreSQL may return
           -- either row depending on scan order, which differs across machines
           -- and would make a pinned baseline count unstable.
           --
           -- The tie-break can't just be appended to the outer ORDER BY
           -- (<-> s.pt, external_id): that extra key stops the planner from using
           -- the GiST index's native KNN traversal for the LIMIT, and it falls
           -- back to fetching and sorting every way inside the tolerance
           -- radius per sample point -- measured 2026-09-23: the whole build
           -- went from ~10s to >120s (cancelled) with 65k+ sample points.
           -- Instead, take a small window of the nearest candidates via the
           -- still-fast KNN path (an exact tie is always among the closest
           -- few, since it's tied for minimum distance by definition), and
           -- break the tie only within that tiny window.
           WITH knn AS (
             SELECT n.name, n.geom, n.external_id, n.geom <-> s.pt AS d
               FROM res_named_ways n
              WHERE ST_DWithin(n.geom, s.pt, $3)
              ORDER BY n.geom <-> s.pt
              LIMIT $6
           ),
           top AS (
             SELECT name, geom FROM knn ORDER BY d, external_id LIMIT 1
           )
           -- The window rows are already materialised here, so checking whether the
           -- window saturated (every one of its $6 rows sits at the same distance as
           -- the closest) costs nothing extra -- unlike a standalone measurement pass
           -- over the whole table, which is prohibitively expensive at this scale.
           -- Saturation means a tie group may extend past the window, so the pick
           -- above is no longer provably scan-order-independent.
           SELECT top.name, top.geom,
                  (SELECT count(*) = $6 AND max(d) = min(d) FROM knn) AS saturated
             FROM top
         ) w
     ),
     voted AS (
       SELECT external_id, name, count(*) AS votes,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dist_m) AS med_m
         FROM nearest GROUP BY external_id, name
     ),
     best AS (
       -- Ties break on the closer candidate, so the outcome does not depend on scan order.
       -- name is the final key: votes and med_m can still tie between two candidate
       -- names for the same reach, and without a total order here too, DISTINCT ON
       -- would pick an arbitrary one per machine, again breaking the pinned baseline.
       SELECT DISTINCT ON (external_id) external_id, name, votes, med_m
         FROM voted ORDER BY external_id, votes DESC, med_m ASC, name ASC
     ),
     accepted AS (
       SELECT external_id, name,
              (votes::real / $2) * (1 - 0.5 * least(med_m, $4) / $4) AS confidence
         FROM best WHERE votes >= $5 AND med_m <= $4
     ),
     applied AS (
       UPDATE water.rivers t
          SET parent_external_id = a.name, match_confidence = a.confidence
         FROM accepted a
        WHERE t.dataset_version_id = $1 AND t.external_id = a.external_id
        RETURNING t.parent_external_id
     ),
     applied_counts AS (
       SELECT count(*) AS matched, count(DISTINCT parent_external_id) AS names FROM applied
     ),
     saturation AS (
       SELECT count(*) AS n FROM nearest WHERE saturated
     )
     SELECT applied_counts.matched::text AS matched,
            applied_counts.names::text AS names,
            saturation.n::text AS saturated
       FROM applied_counts, saturation`,
    [versionId, MATCH_SAMPLES, MATCH_TOLERANCE_DEG, MATCH_MAX_MEDIAN_M, MATCH_MIN_VOTES, MATCH_KNN_WINDOW]
  );
  const saturated = Number(rows[0].saturated);
  if (saturated > 0) {
    throw new Error(
      `assignReachNames: ${saturated} sample point(s) saturated the KNN tie-break window ` +
        `(MATCH_KNN_WINDOW=${MATCH_KNN_WINDOW} in riverHierarchy.ts) -- every candidate in the ` +
        `window sat at the same distance, so a tie group may extend past it and the nearest-way ` +
        `pick for those points is no longer provably deterministic across machines. Widen ` +
        `MATCH_KNN_WINDOW and re-run.`
    );
  }
  return { matched: Number(rows[0].matched), names: Number(rows[0].names) };
}

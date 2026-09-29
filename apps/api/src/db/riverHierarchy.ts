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

/**
 * Confidence written for a bridged gap reach (see `bridgeGaps`). Deliberately below the
 * vote's documented floor of 0.3 (assignReachNames's `accepted` CTE never produces less),
 * so `match_confidence < 0.3` is true if and only if a reach was bridged rather than
 * voted -- a cheap, permanent way to tell the two apart later (see the confidence-range
 * test in riverHierarchy.test.ts and the "reaches" count in riverGates.ts, which counts
 * both). Never 0 and never NULL: a bridged reach IS named, just not by the spatial vote.
 */
export const BRIDGED_CONFIDENCE = 0.2;

/**
 * Bridge single-reach same-name gaps (2026-09-23 decision, reversing the plan's original
 * Deviation 4). A gap is a level-2 reach with no voted name whose downstream reach and at
 * least one upstream reach both carry the SAME voted name. The rule is purely
 * topological: the gap reach's own vote is NOT consulted (it may have found that name,
 * another name, or nothing at all) -- same name on both sides is the whole justification,
 * by the user's decision. Without it, one unnamed reach severs a river connectivity-wise
 * even though the network is physically continuous through it. Measured case:
 * hyriv:41295432, between the 38-reach Sông Thu Bồn group and its own terminal outlet
 * (its vote happened to find Thu Bồn at 3 of 5 samples but failed the median cutoff).
 *
 * Single pass against a SNAPSHOT of the vote result: `vote_snapshot` is materialised once,
 * right after assignReachNames and before any bridging write, so every gap is evaluated
 * against the vote as it left it -- never against a name this same pass just bridged. That
 * makes two consecutive unnamed reaches never bridge each other (the "downstream" or
 * "upstream" required to justify a bridge must be a voted name, which by construction a
 * gap does not have in the snapshot), and makes the result independent of row order: no
 * ORDER BY or DISTINCT ON is needed at all, because each gap's downstream reach is unique
 * (flows_into is one outgoing edge per reach) and the upstream requirement is an EXISTS,
 * not a pick.
 *
 * Reads `water.rivers` directly, not `res_rivers`: res_rivers holds every row of the
 * version (materialiseResolved runs after the load), but it was snapshotted BEFORE
 * assignReachNames wrote the voted names, so its parent_external_id column is stale --
 * and that column is exactly what this step reads. vote_snapshot is this function's own
 * ANALYZEd temp table, so the joins below never plan against raw water.rivers, whose
 * statistics predate this transaction and know nothing about the new version id -- see
 * the perf comment on the flows_into UPDATE in buildLevelOne for what that misestimate
 * cost (~7.5 minutes, measured on the real ingest). Rows marked `deleted` are left out,
 * matching the activation gates.
 */
async function bridgeGaps(client: PoolClient, versionId: string): Promise<number> {
  await client.query(`DROP TABLE IF EXISTS vote_snapshot`);
  await client.query(
    `CREATE TEMP TABLE vote_snapshot AS
     SELECT external_id, parent_external_id AS name, flows_into_external_id
       FROM water.rivers
      WHERE dataset_version_id = $1 AND feature_level = 2 AND NOT deleted`,
    [versionId]
  );
  await client.query(`CREATE UNIQUE INDEX ON vote_snapshot (external_id)`);
  await client.query(`CREATE INDEX ON vote_snapshot (flows_into_external_id)`);
  await client.query(`ANALYZE vote_snapshot`);

  const { rows } = await client.query<{ n: string }>(
    `WITH gaps AS (
       SELECT g.external_id AS gap_id, d.name AS bridge_name
         FROM vote_snapshot g
         JOIN vote_snapshot d ON d.external_id = g.flows_into_external_id
        WHERE g.name IS NULL AND d.name IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM vote_snapshot u
             WHERE u.flows_into_external_id = g.external_id AND u.name = d.name
          )
     ),
     applied AS (
       UPDATE water.rivers t
          SET parent_external_id = gaps.bridge_name, match_confidence = $2
         FROM gaps
        WHERE t.dataset_version_id = $1 AND t.feature_level = 2
          AND t.external_id = gaps.gap_id
        RETURNING 1
     )
     SELECT count(*)::text AS n FROM applied`,
    [versionId, BRIDGED_CONFIDENCE]
  );
  return Number(rows[0].n);
}

/**
 * Build the level-1 rivers for `versionId`, and rewrite the level-2 link that
 * assignReachNames parked as a bare name into the id of the river it resolves to.
 *
 * A river is ONE NAME PLUS ONE CONNECTED GROUP, not one connected component. Spec §2
 * says one river per connected reach set, but a component is a BASIN: measured, the
 * largest one carries 134 distinct OSM names (Sê San, Srêpốk, Krông Ana, Đăk Bla and
 * ~120 named suối), so one-river-per-component would emit a single river and discard 133
 * names. Grouping by name and letting connectivity split disjoint same-name groups is
 * Phase 2's pattern, and it is why 439 names yield 588 rivers (post-bridging; 631 before
 * the 2026-09-23 same-name gap bridging decision -- see bridgeGaps above).
 *
 * The component root is found by walking DOWNSTREAM while the next reach carries the
 * same name. flows_into is a tree (one outgoing link per reach), so a maximal connected
 * same-name subgraph is a subtree with exactly one most-downstream member -- which makes
 * that member a canonical, stable component id with no union-find needed.
 *
 * Reads `water.rivers` directly (scoped to `dataset_version_id = versionId`), not the
 * res_rivers temp table materialiseResolved built: assignReachNames just wrote the voted
 * name into parent_external_id on the live table, after res_rivers was snapshotted, so
 * res_rivers is stale for exactly that column. For an ingest version (buildRiverHierarchy's
 * only caller today) that scope already equals the version's full resolved row set, since
 * an ingest version has no parent chain to inherit rows from.
 */
async function buildLevelOne(client: PoolClient, versionId: string): Promise<number> {
  // The version's named reaches (voted + bridged), as an indexed, ANALYZEd temp table
  // rather than a CTE over raw water.rivers. The table does have statistics, but they
  // predate this transaction and know nothing about the new version id, so the planner
  // would misestimate every join against it -- the same hazard as the flows_into UPDATE
  // below. Rows marked `deleted` are left out, matching the activation gates.
  await client.query(`DROP TABLE IF EXISTS named_reach`);
  await client.query(
    `CREATE TEMP TABLE named_reach AS
     SELECT external_id, parent_external_id AS name, flows_into_external_id AS nd
       FROM water.rivers
      WHERE dataset_version_id = $1 AND feature_level = 2 AND NOT deleted
        AND parent_external_id IS NOT NULL`,
    [versionId]
  );
  await client.query(`CREATE UNIQUE INDEX ON named_reach (external_id)`);
  await client.query(`ANALYZE named_reach`);

  // Reach -> (name, root reach). Roots are computed over the version's own level-2 rows.
  //
  // CYCLE guards the walk against a same-name cycle in flows_into, which would otherwise
  // recurse forever and hang the build before the cycle gate ever ran. A reach on (or
  // walking into) a cycle never reaches a row with nxt IS NULL, so it gets no reach_river
  // row: its parent_external_id keeps the parked name, and assertRiverGates then refuses
  // the version (cycle check, plus the orphaned-parent check).
  await client.query(`DROP TABLE IF EXISTS reach_river`);
  await client.query(
    `CREATE TEMP TABLE reach_river AS
     WITH RECURSIVE edges AS (
       SELECT n.external_id, n.name,
              d.external_id AS same_name_down
         FROM named_reach n LEFT JOIN named_reach d ON d.external_id = n.nd AND d.name = n.name
     ),
     walk AS (
       SELECT external_id AS start_id, name, external_id AS cur, same_name_down AS nxt, 0 AS d
         FROM edges
       UNION ALL
       SELECT w.start_id, w.name, e.external_id, e.same_name_down, w.d + 1
         FROM walk w JOIN edges e ON e.external_id = w.nxt
     ) CYCLE cur SET is_cycle USING path
     SELECT DISTINCT ON (start_id)
            start_id AS reach_external_id, name,
            'river:' || substring(cur from 7) AS river_external_id
       FROM walk WHERE nxt IS NULL AND NOT is_cycle
      ORDER BY start_id, d DESC`
  );
  await client.query(`CREATE INDEX ON reach_river (reach_external_id)`);
  await client.query(`CREATE INDEX ON reach_river (river_external_id)`);
  // Every later join against reach_river (way_river, the ways/reaches CTEs below, and the
  // flows_into UPDATE) needs real row-count and distribution estimates: a freshly created
  // temp table starts with none, so the planner falls back to defaults that are wildly
  // wrong at this size. See the flows_into UPDATE's comment for the failure this caused.
  await client.query(`ANALYZE reach_river`);

  // Each named way joins the same-name river whose reaches lie nearest to it. A name with
  // several disjoint rivers (Sông Cái has 12) must not give all its ways to one of them.
  //
  // river_external_id is the final sort key: two different same-name rivers can sit at
  // the exact same distance from a way (typically 0, both touching it), and distance
  // alone would then leave the pick -- and so the level-1 geometry and length_m -- to
  // scan order. Unlike the vote's KNN, this ORDER BY does not ride a GiST KNN path (the
  // name filter goes through the reach_river join first, then sorts the few candidates),
  // so the extra key does not change the plan; see the Task 6 report for the timing.
  // No distance cap: a same-name way attaches to its nearest same-name river however
  // far away (measured 2026-09-23: 4 ways sit more than 5 km from their river).
  await client.query(`DROP TABLE IF EXISTS way_river`);
  await client.query(
    `CREATE TEMP TABLE way_river AS
     SELECT w.external_id AS way_external_id, best.river_external_id
       FROM res_named_ways w
       CROSS JOIN LATERAL (
         SELECT rr.river_external_id
           FROM reach_river rr JOIN res_rivers r ON r.external_id = rr.reach_external_id
          WHERE rr.name = w.name
          ORDER BY r.geom <-> w.geom, rr.river_external_id
          LIMIT 1
       ) best`
  );
  await client.query(`CREATE INDEX ON way_river (river_external_id)`);

  // The level-1 rows. Geometry derives from the member OSM WAYS, not the member reaches:
  // measured, the two agree to a median length ratio of 1.11 (Sông Ba 349 km of way vs
  // 352 km of reach), so ways cost nothing in extent while giving finer geometry, the
  // same shape the detailed layer already draws, and independence from the spatial vote --
  // a bad match cannot deform a river. Reaches keep their real job: topology and order.
  // COALESCE to the reach geometry because water.rivers.geom is NOT NULL and a river with
  // no surviving member way would otherwise fail the insert.
  //
  // ST_Collect over rows that are ALREADY MultiLineString (every geom in water.rivers is)
  // does not flatten them into one MultiLineString -- measured: it returns a
  // GeometryCollection, which the water.rivers.geom column then refuses at INSERT time
  // ("Geometry type (GeometryCollection) does not match column type (MultiLineString)").
  // ST_Collect only promotes SIMPLE types (Point/LineString/Polygon) to their Multi form;
  // fed a Multi* type it just nests. ST_Dump first, so ST_Collect aggregates plain
  // LineStrings and genuinely returns a MultiLineString. Documented deviation from the
  // plan's example, which collects the undumped geometry directly.
  //
  // Both ST_Collects carry an aggregate ORDER BY (member external_id, then dump path --
  // unique per collected part), so the collected geometry's bytes do not depend on the
  // order rows happen to arrive in.
  const { rows } = await client.query<{ n: string }>(
    `WITH ways AS (
       SELECT wr.river_external_id,
              ST_Collect(d.geom ORDER BY wr.way_external_id, d.path) AS geom
         FROM way_river wr JOIN res_rivers r ON r.external_id = wr.way_external_id,
              ST_Dump(r.geom) AS d
        GROUP BY wr.river_external_id
     ),
     reaches AS (
       SELECT rr.river_external_id, min(rr.name) AS name,
              max(r.stream_order) AS max_order,
              ST_Collect(d.geom ORDER BY rr.reach_external_id, d.path) AS geom
         FROM reach_river rr JOIN res_rivers r ON r.external_id = rr.reach_external_id,
              ST_Dump(r.geom) AS d
        GROUP BY rr.river_external_id
     ),
     built AS (
       SELECT c.river_external_id, c.name, c.max_order,
              ST_Multi(ST_LineMerge(COALESCE(w.geom, c.geom))) AS geom
         FROM reaches c LEFT JOIN ways w ON w.river_external_id = c.river_external_id
     ),
     inserted AS (
       INSERT INTO water.rivers
         (external_id, feature_level, name, stream_order, length_m, geom, dataset_version_id)
       SELECT b.river_external_id, 1, b.name, b.max_order,
              ST_Length(b.geom::geography), b.geom, $1
         FROM built b
       RETURNING 1
     )
     SELECT count(*)::text AS n FROM inserted`,
    [versionId]
  );

  // Replace the parked NAME with the river id, on both levels.
  await client.query(
    `UPDATE water.rivers t SET parent_external_id = rr.river_external_id
       FROM reach_river rr
      WHERE t.dataset_version_id = $1 AND t.feature_level = 2
        AND t.external_id = rr.reach_external_id`,
    [versionId]
  );
  await client.query(
    `UPDATE water.rivers t SET parent_external_id = wr.river_external_id
       FROM way_river wr
      WHERE t.dataset_version_id = $1 AND t.feature_level = 3
        AND t.external_id = wr.way_external_id`,
    [versionId]
  );

  // One row per RIVER (not per member reach): the id of its own outlet/root reach. The
  // filter picks out, from every named reach's reach_river row, exactly the one row whose
  // reach IS that river's root (river_external_id was built FROM that reach's id in the
  // first place), so this is 588 rows (post-bridging), never 4,754.
  await client.query(`DROP TABLE IF EXISTS river_root`);
  await client.query(
    `CREATE TEMP TABLE river_root AS
     SELECT river_external_id, reach_external_id AS root_reach_external_id
       FROM reach_river
      WHERE reach_external_id = 'hyriv:' || substring(river_external_id from 7)`
  );
  await client.query(`CREATE INDEX ON river_root (root_reach_external_id)`);
  await client.query(`ANALYZE river_root`);

  // River A flows into river B when A's outlet reach's NEXT_DOWN lands in B (spec §2).
  // The outlet reach IS the component root, which is encoded in the river's own id.
  //
  // MUST NOT join the raw water.rivers table here: it was just written to by this very
  // transaction (the level-2 UPDATEs above, and the ~23k-row ingest before that), so it
  // carries no planner statistics inside the transaction, and the old version of this
  // query joined it through a computed string expression ('hyriv:' || substring(...))
  // rather than a plain indexed equality, on top of an un-ANALYZEd reach_river. Measured
  // in the real ingest: ~7.5 minutes. river_root and res_rivers are both ANALYZEd temp
  // tables (materialiseResolved ANALYZEs res_rivers; see above for river_root and
  // reach_river), and river_root is one row per river rather than one per member reach,
  // so the join the planner sees here is small, indexed, and estimable on both sides.
  await client.query(
    `UPDATE water.rivers t SET flows_into_external_id = down.river_external_id
       FROM (
         SELECT rv.river_external_id AS river,
                drr.river_external_id
           FROM river_root rv
           JOIN res_rivers root ON root.external_id = rv.root_reach_external_id
                                AND root.feature_level = 2
           JOIN reach_river drr ON drr.reach_external_id = root.flows_into_external_id
          WHERE drr.river_external_id <> rv.river_external_id
       ) down
      WHERE t.dataset_version_id = $1 AND t.feature_level = 1
        AND t.external_id = down.river`,
    [versionId]
  );

  return Number(rows[0].n);
}

/**
 * Clear everything buildRiverHierarchy derives for `versionId`'s OWN rows, so the build
 * starts from the same state whatever ran before: the level-1 rivers, the level-2 name /
 * river link and its confidence, and the level-3 river link.
 *
 * Without this a rebuild over an already-built version was silently wrong (found in
 * review, 2026-09-23): assignReachNames only writes the reaches it ACCEPTS, so a reach
 * bridged last time kept `parent_external_id = 'river:...'`, the bridging snapshot saw it
 * as already named, and it came out as a level-1 river literally NAMED 'river:...' --
 * 669 rivers instead of 588, with every gate passing. Stale level-3 links survived the
 * same way for any way not reassigned.
 *
 * Only derived columns are touched; flows_into_external_id on levels 2/3 is source data.
 * A fresh ingest version has nothing to clear, so this is a no-op there.
 */
async function resetDerived(client: PoolClient, versionId: string): Promise<void> {
  await client.query(
    `DELETE FROM water.rivers WHERE dataset_version_id = $1 AND feature_level = 1`,
    [versionId]
  );
  await client.query(
    `UPDATE water.rivers SET parent_external_id = NULL, match_confidence = NULL
      WHERE dataset_version_id = $1 AND feature_level = 2
        AND (parent_external_id IS NOT NULL OR match_confidence IS NOT NULL)`,
    [versionId]
  );
  await client.query(
    `UPDATE water.rivers SET parent_external_id = NULL
      WHERE dataset_version_id = $1 AND feature_level = 3 AND parent_external_id IS NOT NULL`,
    [versionId]
  );
}

/**
 * The single writer of the derived river hierarchy. Runs inside the caller's
 * transaction, BEFORE the version is activated, so a failed gate rolls the version away
 * entirely -- which is what spec §2's "failure means the version is not activated" means.
 *
 * Idempotent for any starting state of `versionId`'s rows: resetDerived clears the
 * previous build's output first (and runs before materialiseResolved, so res_rivers never
 * snapshots a stale link either).
 */
export async function buildRiverHierarchy(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number; rivers: number; bridged: number }> {
  await resetDerived(client, versionId);
  await materialiseResolved(client, versionId);
  const named = await assignReachNames(client, versionId);
  const bridged = await bridgeGaps(client, versionId);
  const rivers = await buildLevelOne(client, versionId);
  return { ...named, rivers, bridged };
}

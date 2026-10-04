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
 * Give each level-2 reach the name of the nearest named OSM way, by majority vote, and
 * leave the result in temp table `new_reach_name(external_id, name, confidence)`. Writes
 * nothing to water.rivers -- supersedeChangedRows applies the outcome, as a diff.
 *
 * Reads res_rivers/res_named_ways, so it sees the RESOLVED picture and is correct for an
 * ingest version and an edit draft alike. It reads only source data (reach geometry, way
 * names and geometry), never a derived column, so a previous build's output cannot leak
 * into this one -- that leak is what made a rebuild over an already-built version come
 * out as 669 rivers, some literally named 'river:<id>' (found in review, 2026-09-23).
 *
 * Confidence is the share of agreeing samples scaled by median distance (spec §2):
 *   (votes / MATCH_SAMPLES) * (1 - 0.5 * min(median, MAX) / MAX)
 * so an accepted match lands in [0.3, 1.0] -- a unanimous vote on top of the way scores
 * 1.0, a bare majority at the distance limit scores 0.3. Never 0, because a match that
 * was accepted is not no-confidence; a refused match stores NULL instead. Cast to real
 * here, the column's own type, so the diff compares like with like: comparing a freshly
 * computed double against the stored real would see a difference on every reach. `$1::int`
 * is load-bearing for the same reason: left untyped, the parameter is inferred as real
 * and 237 confidences come out 1 ulp away from what the Task 6 build stored (measured).
 *
 * Returns the vote's own counts, before bridging.
 */
async function voteReachNames(client: PoolClient): Promise<{ matched: number; names: number }> {
  await client.query(`DROP TABLE IF EXISTS vote_nearest, new_reach_name`);
  await client.query(
    `CREATE TEMP TABLE vote_nearest AS
     WITH samples AS (
       SELECT r.external_id,
              ST_LineInterpolatePoint(ST_LineMerge(r.geom), (s.i * 2 - 1)::float / ($1 * 2)) AS pt
         FROM res_rivers r, generate_series(1, $1) AS s(i)
        WHERE r.feature_level = 2 AND r.geom IS NOT NULL
          AND ST_GeometryType(ST_LineMerge(r.geom)) = 'ST_LineString'
     )
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
            WHERE ST_DWithin(n.geom, s.pt, $2)
            ORDER BY n.geom <-> s.pt
            LIMIT $3
         ),
         top AS (
           SELECT name, geom FROM knn ORDER BY d, external_id LIMIT 1
         )
         -- The window rows are already materialised here, so checking whether the
         -- window saturated (every one of its $3 rows sits at the same distance as
         -- the closest) costs nothing extra -- unlike a standalone measurement pass
         -- over the whole table, which is prohibitively expensive at this scale.
         -- Saturation means a tie group may extend past the window, so the pick
         -- above is no longer provably scan-order-independent.
         SELECT top.name, top.geom,
                (SELECT count(*) = $3 AND max(d) = min(d) FROM knn) AS saturated
           FROM top
       ) w`,
    [MATCH_SAMPLES, MATCH_TOLERANCE_DEG, MATCH_KNN_WINDOW]
  );
  const { rows: sat } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM vote_nearest WHERE saturated`
  );
  const saturated = Number(sat[0].n);
  if (saturated > 0) {
    throw new Error(
      `voteReachNames: ${saturated} sample point(s) saturated the KNN tie-break window ` +
        `(MATCH_KNN_WINDOW=${MATCH_KNN_WINDOW} in riverHierarchy.ts) -- every candidate in the ` +
        `window sat at the same distance, so a tie group may extend past it and the nearest-way ` +
        `pick for those points is no longer provably deterministic across machines. Widen ` +
        `MATCH_KNN_WINDOW and re-run.`
    );
  }

  await client.query(
    `CREATE TEMP TABLE new_reach_name AS
     WITH voted AS (
       SELECT external_id, name, count(*) AS votes,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dist_m) AS med_m
         FROM vote_nearest GROUP BY external_id, name
     ),
     best AS (
       -- Ties break on the closer candidate, so the outcome does not depend on scan order.
       -- name is the final key: votes and med_m can still tie between two candidate
       -- names for the same reach, and without a total order here too, DISTINCT ON
       -- would pick an arbitrary one per machine, again breaking the pinned baseline.
       SELECT DISTINCT ON (external_id) external_id, name, votes, med_m
         FROM voted ORDER BY external_id, votes DESC, med_m ASC, name ASC
     )
     SELECT external_id, name,
            ((votes::real / $1::int) * (1 - 0.5 * least(med_m, $2) / $2))::real AS confidence
       FROM best WHERE votes >= $3 AND med_m <= $2`,
    [MATCH_SAMPLES, MATCH_MAX_MEDIAN_M, MATCH_MIN_VOTES]
  );
  await client.query(`CREATE UNIQUE INDEX ON new_reach_name (external_id)`);
  const { rows } = await client.query<{ matched: string; names: string }>(
    `SELECT count(*)::text AS matched, count(DISTINCT name)::text AS names FROM new_reach_name`
  );
  return { matched: Number(rows[0].matched), names: Number(rows[0].names) };
}

/**
 * Confidence written for a bridged gap reach (see `bridgeGaps`). Deliberately below the
 * vote's documented floor of 0.3 (voteReachNames never produces less), so
 * `match_confidence < 0.3` is true if and only if a reach was bridged rather than
 * voted -- a cheap, permanent way to tell the two apart later (see the confidence-range
 * test in riverHierarchy.test.ts and the "reaches" count in riverGates.ts, which counts
 * both). Never 0 and never NULL: a bridged reach IS named, just not by the spatial vote.
 */
export const BRIDGED_CONFIDENCE = 0.2;

/**
 * Bridge single-reach same-name gaps (2026-09-23 decision, reversing the plan's original
 * Deviation 4), by adding rows to `new_reach_name`. A gap is a level-2 reach with no voted
 * name whose downstream reach and at least one upstream reach both carry the SAME voted
 * name. The rule is purely topological: the gap reach's own vote is NOT consulted (it may
 * have found that name, another name, or nothing at all) -- same name on both sides is
 * the whole justification, by the user's decision. Without it, one unnamed reach severs a
 * river connectivity-wise even though the network is physically continuous through it.
 * Measured case: hyriv:41295432, between the 38-reach Sông Thu Bồn group and its own
 * terminal outlet (its vote happened to find Thu Bồn at 3 of 5 samples but failed the
 * median cutoff).
 *
 * Single pass against a SNAPSHOT of the vote result: `vote_snapshot` is materialised once,
 * before any bridge is added, so every gap is evaluated against the vote as it left it --
 * never against a name this same pass just bridged. That makes two consecutive unnamed
 * reaches never bridge each other (the "downstream" or "upstream" required to justify a
 * bridge must be a voted name, which by construction a gap does not have in the
 * snapshot), and makes the result independent of row order: no ORDER BY or DISTINCT ON is
 * needed at all, because each gap's downstream reach is unique (flows_into is one
 * outgoing edge per reach) and the upstream requirement is an EXISTS, not a pick.
 *
 * Runs over the resolved reach set, so an edit draft gets the same bridges an ingest does.
 */
async function bridgeGaps(client: PoolClient): Promise<number> {
  await client.query(`DROP TABLE IF EXISTS vote_snapshot`);
  await client.query(
    `CREATE TEMP TABLE vote_snapshot AS
     SELECT r.external_id, n.name, r.flows_into_external_id
       FROM res_rivers r LEFT JOIN new_reach_name n ON n.external_id = r.external_id
      WHERE r.feature_level = 2`
  );
  await client.query(`CREATE UNIQUE INDEX ON vote_snapshot (external_id)`);
  await client.query(`CREATE INDEX ON vote_snapshot (flows_into_external_id)`);
  await client.query(`ANALYZE vote_snapshot`);

  const bridged = await client.query(
    `INSERT INTO new_reach_name (external_id, name, confidence)
     SELECT g.external_id, d.name, $1::real
       FROM vote_snapshot g
       JOIN vote_snapshot d ON d.external_id = g.flows_into_external_id
      WHERE g.name IS NULL AND d.name IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM vote_snapshot u
           WHERE u.flows_into_external_id = g.external_id AND u.name = d.name
        )`,
    [BRIDGED_CONFIDENCE]
  );
  await client.query(`ANALYZE new_reach_name`);
  return bridged.rowCount ?? 0;
}

/**
 * Group the named reaches into rivers: temp tables `reach_river(reach_external_id, name,
 * river_external_id)` and `way_river(way_external_id, river_external_id)`. No writes to
 * water.rivers.
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
 */
async function computeRiverGrouping(client: PoolClient): Promise<void> {
  // The named reaches (voted + bridged) over the RESOLVED reach set, as an indexed,
  // ANALYZEd temp table: an edit draft holds no reaches of its own, so reading by version
  // would yield zero rivers.
  await client.query(`DROP TABLE IF EXISTS named_reach, reach_river, way_river`);
  await client.query(
    `CREATE TEMP TABLE named_reach AS
     SELECT r.external_id, n.name, r.flows_into_external_id AS nd
       FROM res_rivers r JOIN new_reach_name n ON n.external_id = r.external_id
      WHERE r.feature_level = 2`
  );
  await client.query(`CREATE UNIQUE INDEX ON named_reach (external_id)`);
  await client.query(`ANALYZE named_reach`);

  // Reach -> (name, root reach).
  //
  // CYCLE guards the walk against a same-name cycle in flows_into, which would otherwise
  // recurse forever and hang the build before the cycle gate ever ran. A reach on (or
  // walking into) a cycle never reaches a row with nxt IS NULL, so it gets no reach_river
  // row and so no river: assertRiverGates then refuses the version on the cycle itself.
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
  // Every later join against reach_river needs real row-count and distribution estimates:
  // a freshly created temp table starts with none, so the planner falls back to defaults
  // that are wildly wrong at this size. See buildLevelOneGeometry's flows_into step for
  // the failure this caused.
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
  await client.query(`CREATE INDEX ON way_river (way_external_id)`);
  await client.query(`CREATE INDEX ON way_river (river_external_id)`);
  await client.query(`ANALYZE way_river`);
}

/**
 * The level-1 rivers as they should now be: temp table `new_river(external_id, name,
 * max_order, geom, length_m, flows_into)`. No writes to water.rivers. Returns its count.
 *
 * Geometry derives from the member OSM WAYS, not the member reaches: measured, the two
 * agree to a median length ratio of 1.11 (Sông Ba 349 km of way vs 352 km of reach), so
 * ways cost nothing in extent while giving finer geometry, the same shape the detailed
 * layer already draws, and independence from the spatial vote -- a bad match cannot
 * deform a river. Reaches keep their real job: topology and order. COALESCE to the reach
 * geometry because water.rivers.geom is NOT NULL and a river with no surviving member way
 * would otherwise fail the insert.
 */
async function buildLevelOneGeometry(client: PoolClient): Promise<number> {
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
  // order rows happen to arrive in. That is load-bearing for the diff: a rebuild of an
  // unchanged network must produce byte-identical geometry, or every river is superseded
  // on every commit.
  await client.query(`DROP TABLE IF EXISTS new_river, river_root`);
  await client.query(
    `CREATE TEMP TABLE new_river AS
     WITH ways AS (
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
     )
     SELECT river_external_id AS external_id, name, max_order, geom,
            ST_Length(geom::geography) AS length_m, NULL::text AS flows_into
       FROM built`
  );
  await client.query(`CREATE UNIQUE INDEX ON new_river (external_id)`);

  // One row per RIVER (not per member reach): the id of its own outlet/root reach. The
  // filter picks out, from every named reach's reach_river row, exactly the one row whose
  // reach IS that river's root (river_external_id was built FROM that reach's id in the
  // first place), so this is 588 rows (post-bridging), never 4,754.
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
  // Every table joined here is an ANALYZEd temp table. The Task 6 version of this step
  // joined raw water.rivers -- freshly written in the same transaction, so without
  // planner statistics for the new version -- through a computed string expression, on
  // top of an un-ANALYZEd reach_river. Measured in the real ingest: ~7.5 minutes.
  await client.query(
    `UPDATE new_river t SET flows_into = down.river_external_id
       FROM (
         SELECT rv.river_external_id AS river,
                drr.river_external_id
           FROM river_root rv
           JOIN res_rivers root ON root.external_id = rv.root_reach_external_id
                                AND root.feature_level = 2
           JOIN reach_river drr ON drr.reach_external_id = root.flows_into_external_id
          WHERE drr.river_external_id <> rv.river_external_id
       ) down
      WHERE t.external_id = down.river`
  );
  await client.query(`ANALYZE new_river`);

  const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM new_river`);
  return Number(rows[0].n);
}

/**
 * Write a superseding row into `versionId` for each derived value that actually changed,
 * and return how many rows that wrote. Compares the build's temp tables against
 * res_rivers, the resolved state as of before this build.
 *
 * A row that already belongs to `versionId` (every row of an ingest version; a way the
 * steward edited in this draft) conflicts on (dataset_version_id, external_id) and is
 * updated in place instead -- it is this version's own row, not an ancestor's. Nothing in
 * an ancestor version is ever touched.
 */
async function supersedeChangedRows(client: PoolClient, versionId: string): Promise<number> {
  const COLS = `external_id, feature_level, name, code, stream_order, length_m,
                parent_external_id, flows_into_external_id, match_confidence, geom,
                dataset_version_id`;
  let n = 0;

  // 1. Level-2 reaches whose river link or confidence moved. `IS DISTINCT FROM` and not
  //    `<>`, so a NULL on either side counts as a difference -- a reach that just lost its
  //    match must be superseded too, and `<>` would return NULL and skip it. The name is
  //    joined THROUGH the river link, so a named reach that got no river (it sits on a
  //    cycle) carries no confidence either: the two always travel together.
  const reaches = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT r.external_id, r.feature_level, r.name, r.code, r.stream_order, r.length_m,
            rr.river_external_id, r.flows_into_external_id, nn.confidence, r.geom, $1
       FROM res_rivers r
       LEFT JOIN reach_river rr ON rr.reach_external_id = r.external_id
       LEFT JOIN new_reach_name nn ON nn.external_id = rr.reach_external_id
      WHERE r.feature_level = 2
        AND (r.parent_external_id IS DISTINCT FROM rr.river_external_id
             OR r.match_confidence IS DISTINCT FROM nn.confidence)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET parent_external_id = EXCLUDED.parent_external_id,
            match_confidence   = EXCLUDED.match_confidence`,
    [versionId]
  );
  n += reaches.rowCount ?? 0;

  // 2. Level-3 ways whose river link moved. Geometry and attributes are copied from the
  //    resolved row, so a way edited in this very draft keeps the steward's new geometry.
  const ways = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT r.external_id, r.feature_level, r.name, r.code, r.stream_order, r.length_m,
            w.river_external_id, r.flows_into_external_id, r.match_confidence, r.geom, $1
       FROM res_rivers r LEFT JOIN way_river w ON w.way_external_id = r.external_id
      WHERE r.feature_level = 3
        AND r.parent_external_id IS DISTINCT FROM w.river_external_id
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET parent_external_id = EXCLUDED.parent_external_id`,
    [versionId]
  );
  n += ways.rowCount ?? 0;

  // 3. Level-1 rivers that are new, or whose name/order/outflow/geometry changed.
  //    ST_OrderingEquals is exact, vertex-for-vertex equality -- the right test, since the
  //    build is deterministic down to the vertex order (see buildLevelOneGeometry) -- and
  //    cheap, unlike ST_Equals, which computes a full topological relate per river.
  //    `deleted = false` on conflict: a river this version had tombstoned may come back.
  const rivers = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT b.external_id, 1, b.name, NULL, b.max_order, b.length_m,
            NULL, b.flows_into, NULL, b.geom, $1
       FROM new_river b LEFT JOIN res_rivers r
            ON r.external_id = b.external_id AND r.feature_level = 1
      WHERE r.external_id IS NULL
         OR r.name IS DISTINCT FROM b.name
         OR r.stream_order IS DISTINCT FROM b.max_order
         OR r.flows_into_external_id IS DISTINCT FROM b.flows_into
         OR NOT ST_OrderingEquals(r.geom, b.geom)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET name = EXCLUDED.name, stream_order = EXCLUDED.stream_order,
            length_m = EXCLUDED.length_m, geom = EXCLUDED.geom,
            flows_into_external_id = EXCLUDED.flows_into_external_id, deleted = false`,
    [versionId]
  );
  n += rivers.rowCount ?? 0;

  // 4. Tombstone a river whose last named reach is gone. Without this it keeps resolving
  //    from the ancestor version -- a river that no longer exists, still searchable.
  const gone = await client.query(
    `INSERT INTO water.rivers (${COLS}, deleted)
     SELECT r.external_id, 1, r.name, NULL, r.stream_order, r.length_m,
            NULL, NULL, NULL, r.geom, $1, true
       FROM res_rivers r
      WHERE r.feature_level = 1
        AND NOT EXISTS (SELECT 1 FROM new_river b WHERE b.external_id = r.external_id)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE SET deleted = true`,
    [versionId]
  );
  n += gone.rowCount ?? 0;

  return n;
}

/**
 * THE single writer of the derived river hierarchy, for ANY version. Called from
 * versionsService.activate(), inside the caller's transaction and BEFORE the version is
 * activated, so a failed gate rolls the version away entirely -- which is what spec §2's
 * "failure means the version is not activated" means.
 *
 * Correct on an ingest version (which holds every row) and on an edit draft (which holds
 * only the edited ones), because every read goes through the resolved temp tables and
 * every write is an INSERT of a superseding row into versionId -- the same mechanism an
 * ordinary edit uses.
 *
 * Only DIFFERENCES are written. A wholesale rewrite would be simpler and always correct,
 * but it would add every reach, way and river plus one chain level per commit, and
 * rivers_active resolves that chain on every read. It also makes the build idempotent:
 * every input is source data, never a derived column, so re-running it over an
 * already-built version writes nothing (`superseded: 0`).
 *
 * `matched`/`names` are the spatial vote's own counts; `bridged` is counted separately.
 */
export async function buildRiverHierarchy(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number; rivers: number; bridged: number; superseded: number }> {
  await materialiseResolved(client, versionId);
  const voted = await voteReachNames(client);
  const bridged = await bridgeGaps(client);
  await computeRiverGrouping(client);
  const rivers = await buildLevelOneGeometry(client);
  const superseded = await supersedeChangedRows(client, versionId);
  return { ...voted, rivers, bridged, superseded };
}

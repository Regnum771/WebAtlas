/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * admin.province_borders: the lines the map draws for province boundaries, so the coast and the
 * islands are no longer stroked.
 *
 * Drawing each province polygon's outline strokes the whole coastline and a ring round every
 * island, which at country scale scatters dark rings over the sea and doubles the basemap's own
 * coast. A map draws only land boundaries, so this table holds:
 *   - kind 'province': each stretch two provinces share, taken from the province with the lower
 *     code, wherever its outline runs within 0.0002 degrees (~22 m) of the other's. The tolerance
 *     covers the source's small mismatches (exact intersection loses ~0.4 % of the shared length
 *     in short gaps);
 *   - kind 'national': the national land border. It is the part of the mainland outline between
 *     the two points where the land border meets the sea (the Bac Luan mouth at Mong Cai and Ha
 *     Tien), on the side that holds the country's westernmost point. The other side is the coast.
 *
 * admin.rebuild_province_borders() recomputes it from admin.provinces (about 3 s). The boundary
 * pipeline (packages/atlas-data descriptors/adminBoundaries.ts) calls it after every province
 * load; this migration calls it once so an existing database has the lines straight away.
 *
 * Read by the API's tile endpoint only, so no grant to webatlas_assistant.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE admin.province_borders (
      id serial PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('province', 'national')),
      geom geometry(MultiLineString, 4326) NOT NULL
    );
    CREATE INDEX province_borders_geom_idx ON admin.province_borders USING gist (geom);
  `);
  pgm.sql(`
    CREATE FUNCTION admin.rebuild_province_borders() RETURNS integer
    LANGUAGE plpgsql
    SET search_path = public, pg_catalog
    AS $fn$
    DECLARE n integer;
    BEGIN
      DELETE FROM admin.province_borders;

      INSERT INTO admin.province_borders (kind, geom)
      SELECT 'province', ST_Multi(g)
        FROM (
          SELECT ST_LineMerge(ST_CollectionExtract(
                   ST_Intersection(ST_Boundary(a.geom), ST_Buffer(ST_Boundary(b.geom), 0.0002)), 2)) AS g
            FROM admin.provinces a
            JOIN admin.provinces b ON a.code < b.code AND ST_DWithin(a.geom, b.geom, 0.0002)
        ) s
       WHERE NOT ST_IsEmpty(g);

      INSERT INTO admin.province_borders (kind, geom)
      WITH nat AS (SELECT ST_Union(geom) AS g FROM admin.provinces),
      mainland AS (SELECT d.geom FROM nat, ST_Dump(nat.g) d ORDER BY ST_Area(d.geom) DESC LIMIT 1),
      ring AS (SELECT ST_ExteriorRing(geom) AS r FROM mainland),
      cut AS (
        SELECT r,
               least(ST_LineLocatePoint(r, ST_SetSRID(ST_Point(107.99, 21.53), 4326)),
                     ST_LineLocatePoint(r, ST_SetSRID(ST_Point(104.45, 10.42), 4326))) AS lo,
               greatest(ST_LineLocatePoint(r, ST_SetSRID(ST_Point(107.99, 21.53), 4326)),
                        ST_LineLocatePoint(r, ST_SetSRID(ST_Point(104.45, 10.42), 4326))) AS hi
          FROM ring
      ),
      sides AS (
        SELECT ST_LineSubstring(r, lo, hi) AS side FROM cut
        UNION ALL
        SELECT ST_LineMerge(ST_Collect(ST_LineSubstring(r, hi, 1), ST_LineSubstring(r, 0, lo))) FROM cut
      )
      SELECT 'national', ST_Multi(side) FROM sides ORDER BY ST_XMin(side) LIMIT 1;

      SELECT count(*) INTO n FROM admin.province_borders;
      RETURN n;
    END
    $fn$;
  `);
  pgm.sql(`SELECT admin.rebuild_province_borders()`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION admin.rebuild_province_borders()`);
  pgm.sql(`DROP TABLE admin.province_borders`);
};

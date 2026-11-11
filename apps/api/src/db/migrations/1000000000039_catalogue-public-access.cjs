/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * GeoNode's own permissions on a catalogue entry (S1 final review, I1).
 *
 * - catalogue.resources.public_view / public_download: whether GeoNode grants AnonymousUser (or the
 *   anonymous group) view_resourcebase / download_resourcebase on the resource. The Dagster sync
 *   copies them from the bridge listing. A published entry is shown to everyone only when
 *   public_view holds (apps/api/src/modules/catalogue/access.ts), and its data may be copied into
 *   Bản của tôi only when public_download holds or the caller owns it: the API reads GeoServer with
 *   the admin account, which bypasses GeoFence. Both default to false, so an entry stays private
 *   until the sync has read GeoNode's permissions.
 * - catalogue.unit_for_bbox(): the same function as migration 36 with pg_temp last in its
 *   search_path (hygiene for a SECURITY DEFINER function). Migration 36 is never edited.
 */
const unitForBbox = (searchPath) => `
  CREATE OR REPLACE FUNCTION catalogue.unit_for_bbox(w float8, s float8, e float8, n float8) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ${searchPath} AS $fn$
    WITH g AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom)
    SELECT admin.managing_unit_for(
             ARRAY(SELECT p.code FROM admin.provinces p, g WHERE ST_Intersects(g.geom, p.geom) ORDER BY p.code),
             ARRAY(SELECT wd.code FROM admin.wards wd, g WHERE ST_Intersects(g.geom, wd.geom) ORDER BY wd.code)
           )
  $fn$
`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE catalogue.resources
      ADD COLUMN public_view boolean NOT NULL DEFAULT false,
      ADD COLUMN public_download boolean NOT NULL DEFAULT false
  `);
  // CREATE OR REPLACE keeps the owner and the grants (EXECUTE revoked from PUBLIC in migration 36).
  pgm.sql(unitForBbox('pg_catalog, public, pg_temp'));
};

exports.down = (pgm) => {
  pgm.sql(unitForBbox('pg_catalog, public'));
  pgm.sql(`ALTER TABLE catalogue.resources DROP COLUMN public_download, DROP COLUMN public_view`);
};

/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * A GeoNode Map or Document has no GeoServer layer, so GeoNode never gives it an `alternate`
 * (confirmed against a real Map: alternate is None). catalogue_sync.sync() required a non-empty
 * alternate for every kind alike, so every Map (and presumably every Document) was silently
 * skipped and never reached catalogue.resources at all — proxy.ts's and copy.ts's "map/document
 * are link-only" handling, and now catalogue.map_composition, had no row to ever apply to.
 *
 * alternate becomes nullable, required only for the kinds that do have a GeoServer layer.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE catalogue.resources ALTER COLUMN alternate DROP NOT NULL;
    ALTER TABLE catalogue.resources ADD CONSTRAINT resources_alternate_check
      CHECK (kind IN ('map', 'document') OR (alternate IS NOT NULL AND alternate <> ''));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM catalogue.resources WHERE alternate IS NULL;
    ALTER TABLE catalogue.resources DROP CONSTRAINT resources_alternate_check;
    ALTER TABLE catalogue.resources ALTER COLUMN alternate SET NOT NULL;
  `);
};

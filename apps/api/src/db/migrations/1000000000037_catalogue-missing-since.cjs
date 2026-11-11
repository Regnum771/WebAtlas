/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * catalogue.resources.missing_since: the Dagster sync deletes a row in two steps. A full GeoNode
 * listing that lacks the row only marks it (missing_since = that run's start); a later full
 * listing that still lacks it deletes it. A row listed again is unmarked.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE catalogue.resources ADD COLUMN missing_since timestamptz`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE catalogue.resources DROP COLUMN missing_since`);
};

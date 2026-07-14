/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // 19 source dam features have no coordinates; store NULL geometry (valid GeoJSON
  // "geometry": null downstream) instead of a malformed empty Point.
  pgm.alterColumn({ schema: 'water', name: 'dams' }, 'geom', { notNull: false });
};

exports.down = (pgm) => {
  // Note: fails if NULL-geom rows exist; acceptable for a forward migration.
  pgm.alterColumn({ schema: 'water', name: 'dams' }, 'geom', { notNull: true });
};

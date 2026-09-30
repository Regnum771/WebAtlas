/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * GIN index on basemap.reference_entities.member_ids, for "which entity is the segment I
 * clicked part of" (the map popup's "Dùng làm vùng phân tích", Phase 4 spec §10). The
 * table is rebuilt by `npm run reference:build` with DELETE + INSERT, never dropped, so
 * the index survives every rebuild (migration 17 explains why this table, unlike the
 * loader's, can hold indexes at all).
 */
exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX IF NOT EXISTS reference_entities_member_ids_gin
             ON basemap.reference_entities USING GIN (member_ids)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS basemap.reference_entities_member_ids_gin`);
};

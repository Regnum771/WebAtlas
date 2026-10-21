/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Indexes for the job list (P3b, apps/api/src/modules/workspace/jobs.ts):
 * - jobs_owner_created_idx: a user's newest jobs, `WHERE owner_id = $1 ORDER BY created_at DESC
 *   LIMIT 50` (optionally also filtered by map);
 * - jobs_map_idx: the map filter of the list, and the ON DELETE CASCADE from workspace.maps.
 *
 * A migration of its own: 028 is already applied.
 */
const S = 'workspace';

exports.up = (pgm) => {
  pgm.sql(`CREATE INDEX jobs_owner_created_idx ON ${S}.jobs (owner_id, created_at DESC)`);
  pgm.createIndex({ schema: S, name: 'jobs' }, 'map_id', { name: 'jobs_map_idx' });
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: S, name: 'jobs' }, 'map_id', { name: 'jobs_map_idx' });
  pgm.sql(`DROP INDEX ${S}.jobs_owner_created_idx`);
};

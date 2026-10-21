/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * workspace.map_role(map, user): the user's role on a personal map, 'owner', 'recipient' or NULL
 * when the user may not see it. The one definition of that rule, shared by the API
 * (apps/api/src/modules/workspace/access.ts mapRole) and the GDAL worker (export_vector.py
 * re-checks it when an export job runs, since a share can be revoked after the job was queued).
 *
 * The predicate is access.ts's, unchanged: the owner; else a recipient when the map is shared with
 * the user directly or with an access group the user belongs to right now; an archived map is
 * NULL for everyone, its owner included. Admin rights play no part.
 *
 * No EXECUTE for PUBLIC or webatlas_assistant.
 */
const ROLE = 'webatlas_assistant';
const FN = 'workspace.map_role(uuid, uuid)';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION workspace.map_role(p_map uuid, p_user uuid) RETURNS text
    LANGUAGE sql STABLE AS $fn$
      SELECT CASE
               WHEN m.owner_id = p_user THEN 'owner'
               WHEN EXISTS (
                 SELECT 1 FROM workspace.map_shares s
                  WHERE s.map_id = m.id
                    AND (s.user_id = p_user
                         OR s.group_id IN (SELECT ug.group_id FROM app.user_groups ug WHERE ug.user_id = p_user))
               ) THEN 'recipient'
             END
        FROM workspace.maps m
       WHERE m.id = p_map AND m.archived_at IS NULL
    $fn$;
  `);
  pgm.sql(`REVOKE ALL ON FUNCTION ${FN} FROM PUBLIC, ${ROLE};`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION ${FN};`);
};

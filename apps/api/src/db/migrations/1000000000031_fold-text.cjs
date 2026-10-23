/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * workspace.fold_text(text): text folded for a search that ignores case and Vietnamese
 * diacritics ('Hồ' -> 'ho', 'Điện' -> 'dien'). The share-target search
 * (apps/api/src/modules/workspace/sharing.ts targets) compares fold_text(column) LIKE
 * fold_text(pattern), so both sides are folded by the same rule.
 *
 * unaccent is a contrib extension shipped with the PostGIS image. Its own function is only
 * STABLE (the dictionary could change); this wrapper is declared IMMUTABLE, as is usual for a
 * fixed dictionary, with search_path pinned so the dictionary and function resolve to the
 * extension's, whatever the caller's search_path.
 *
 * No EXECUTE for PUBLIC or webatlas_assistant, as migration 30 does. Down drops the function
 * only: the extension may have other users by then.
 */
const ROLE = 'webatlas_assistant';
const FN = 'workspace.fold_text(text)';

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;`);
  pgm.sql(`
    CREATE FUNCTION workspace.fold_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = public, pg_catalog
    AS $fn$
      SELECT lower(public.unaccent('public.unaccent'::regdictionary, t))
    $fn$;
  `);
  pgm.sql(`REVOKE ALL ON FUNCTION ${FN} FROM PUBLIC, ${ROLE};`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION ${FN};`);
};

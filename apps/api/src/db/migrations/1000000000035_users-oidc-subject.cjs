/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Single sign-on through the platform's identity provider (Keycloak).
 *   - oidc_subject: the provider's stable `sub` for the account; set on the first SSO sign-in.
 *     Unique, so one provider account maps to one WebAtlas user.
 *   - password_hash becomes optional: an account created by an SSO sign-in has no WebAtlas
 *     password, and the password sign-in refuses it.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app.users ADD COLUMN oidc_subject text;
    ALTER TABLE app.users ADD CONSTRAINT users_oidc_subject_key UNIQUE (oidc_subject);
    ALTER TABLE app.users ALTER COLUMN password_hash DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM app.users WHERE password_hash IS NULL;
    ALTER TABLE app.users ALTER COLUMN password_hash SET NOT NULL;
    ALTER TABLE app.users DROP CONSTRAINT users_oidc_subject_key;
    ALTER TABLE app.users DROP COLUMN oidc_subject;
  `);
};

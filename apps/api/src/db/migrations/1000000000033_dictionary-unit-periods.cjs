/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * The stored-unit periods of the data dictionary (Plan C Task 6, Ruling 6).
 *
 * A staff correction of an attribute's stored unit applies from a date, so older data versions
 * keep the unit they were loaded in. Each row records one stored unit and the date it applies
 * from; readers use the attribute's current stored unit, and the periods are kept for later
 * readers of past data versions.
 *
 * - No grant to webatlas_assistant, like the other dictionary tables (migration 32).
 * - ON DELETE RESTRICT on the attribute: the dictionary retires attributes, never deletes them.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app.dictionary_unit_periods (
      feature_type text NOT NULL,
      attribute text NOT NULL,
      stored_unit text NOT NULL,
      valid_from date NOT NULL,
      created_by uuid NULL REFERENCES app.users(id) ON DELETE SET NULL,
      created_at timestamptz DEFAULT now(),
      PRIMARY KEY (feature_type, attribute, valid_from),
      FOREIGN KEY (feature_type, attribute) REFERENCES app.dictionary_attributes(feature_type, name) ON DELETE RESTRICT
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE app.dictionary_unit_periods`);
};

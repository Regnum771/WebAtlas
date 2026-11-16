/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * A GeoNode "Map" resource (kind 'map') has no GeoServer layer of its own — it is a saved
 * composition of other resources' layers, so the catalogue's WMS proxy refuses it (proxy.ts) and
 * it can only ever be added to a personal map as a dead link. catalogue.map_composition records
 * what a Map is made of (synced from GeoNode's own MapLayer rows, orchestration/catalogue_sync.py),
 * so the API can resolve "add this Map" into its constituent, already-catalogued layers instead.
 *
 * - map_resource_id: the Map (kind 'map'); position: GeoNode's layer order (0 = bottom).
 * - layer_resource_id: the constituent layer's own catalogue.resources row. Nullable (a GeoNode
 *   layer that is not local, or not synced into the catalogue yet) and ON DELETE SET NULL (the
 *   catalogue's own two-step deletion): a row the sync or the API cannot resolve is simply skipped
 *   when expanding, rather than losing the Map's other layers or the whole composition row.
 * - Full-replace sync: a Map's composition is deleted and reinserted each time it is synced (small
 *   lists, and GeoNode gives no stable id to diff against), hence no other unique constraint.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE catalogue.map_composition (
      map_resource_id uuid NOT NULL REFERENCES catalogue.resources (id) ON DELETE CASCADE,
      position integer NOT NULL CHECK (position >= 0),
      layer_resource_id uuid REFERENCES catalogue.resources (id) ON DELETE SET NULL,
      visible boolean NOT NULL DEFAULT true,
      opacity real NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1),
      PRIMARY KEY (map_resource_id, position)
    )
  `);
  pgm.sql(`
    CREATE INDEX map_composition_layer_resource_idx ON catalogue.map_composition (layer_resource_id)
      WHERE layer_resource_id IS NOT NULL
  `);
  pgm.sql(`REVOKE ALL ON TABLE catalogue.map_composition FROM PUBLIC, webatlas_assistant`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE catalogue.map_composition`);
};

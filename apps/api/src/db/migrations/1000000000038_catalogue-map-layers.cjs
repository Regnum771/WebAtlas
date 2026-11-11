/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Catalogue links in personal maps (S1 of the catalogue-to-map plan, Task 12).
 *
 * - workspace.map_layers.kind gains 'catalogue': a layer that shows a catalogue.resources entry
 *   (drawn by the client through the catalogue's map proxy) and holds no data of its own.
 * - catalogue_resource_id: the entry it links to. Nullable and not tied to the kind by a check: the
 *   API requires it when such a layer is created, and when the resource row is deleted (the sync's
 *   two-step deletion) the layer keeps its row with a null id, so the map shows the link as gone
 *   ("đã bị xoá") instead of losing the layer silently.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE workspace.map_layers DROP CONSTRAINT map_layers_kind_check;
    ALTER TABLE workspace.map_layers ADD CONSTRAINT map_layers_kind_check
      CHECK (kind IN ('free', 'edit_copy', 'raster', 'annotation', 'catalogue'));
    ALTER TABLE workspace.map_layers
      ADD COLUMN catalogue_resource_id uuid REFERENCES catalogue.resources (id) ON DELETE SET NULL;
    CREATE INDEX map_layers_catalogue_resource_idx ON workspace.map_layers (catalogue_resource_id)
      WHERE catalogue_resource_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  // The old check refuses catalogue links, so they go, and each map's order is closed up again
  // (the unique (map_id, position) is deferred, so one UPDATE is safe).
  pgm.sql(`
    DELETE FROM workspace.map_layers WHERE kind = 'catalogue';
    UPDATE workspace.map_layers l SET position = r.rn
      FROM (SELECT id, (row_number() OVER (PARTITION BY map_id ORDER BY position) - 1)::int AS rn
              FROM workspace.map_layers) r
     WHERE r.id = l.id AND l.position <> r.rn;
    ALTER TABLE workspace.map_layers DROP COLUMN catalogue_resource_id;
    ALTER TABLE workspace.map_layers DROP CONSTRAINT map_layers_kind_check;
    ALTER TABLE workspace.map_layers ADD CONSTRAINT map_layers_kind_check
      CHECK (kind IN ('free', 'edit_copy', 'raster', 'annotation'));
  `);
};

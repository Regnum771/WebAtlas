/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Durable edit drafts (P2 of docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md).
 *
 * - app.dataset_versions.draft_status: NULL for ingest versions and published edits; for an
 *   open draft one of 'personal' (editable by its owner), 'submitted' or 'returned' (P4).
 *   dataset_versions_draft_shape keeps a draft an inactive edit version: publishing clears
 *   draft_status before the version is activated, in the same transaction.
 * - revision: bumped on every change to a draft, so a stale client is refused (DRAFT_CHANGED).
 * - updated_at: when the draft last changed.
 * - dataset_versions_open_drafts_idx: the open drafts of a layer, read on every activation
 *   (retention keeps them and their ancestor chain) and when listing drafts.
 * - app.draft_resolutions: per draft and feature, the conflict choice the draft's owner made
 *   against a given active version. A choice made against an older active version no longer
 *   counts once the active version moves.
 *
 * No grant to webatlas_assistant: drafts are private working state.
 */
const VERSIONS = { schema: 'app', name: 'dataset_versions' };
const RESOLUTIONS = { schema: 'app', name: 'draft_resolutions' };

exports.up = (pgm) => {
  pgm.addColumn(VERSIONS, {
    draft_status: { type: 'text' },
    revision: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint(VERSIONS, 'dataset_versions_draft_status', {
    check: `draft_status IN ('personal', 'submitted', 'returned')`,
  });
  pgm.addConstraint(VERSIONS, 'dataset_versions_draft_shape', {
    check: `draft_status IS NULL OR (kind = 'edit' AND NOT is_active)`,
  });

  pgm.createIndex(VERSIONS, 'layer_key', {
    name: 'dataset_versions_open_drafts_idx',
    where: 'draft_status IS NOT NULL',
  });

  pgm.createTable(RESOLUTIONS, {
    draft_id: {
      type: 'uuid',
      notNull: true,
      references: VERSIONS,
      onDelete: 'CASCADE',
    },
    external_id: { type: 'text', notNull: true },
    against_version_id: {
      type: 'uuid',
      notNull: true,
      references: VERSIONS,
      onDelete: 'CASCADE',
    },
    choice: { type: 'text', notNull: true, check: `choice IN ('mine', 'theirs')` },
    resolved_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, {
    constraints: { primaryKey: ['draft_id', 'external_id'] },
  });
};

exports.down = (pgm) => {
  pgm.dropTable(RESOLUTIONS);
  pgm.dropIndex(VERSIONS, 'layer_key', { name: 'dataset_versions_open_drafts_idx' });
  pgm.dropConstraint(VERSIONS, 'dataset_versions_draft_shape');
  pgm.dropConstraint(VERSIONS, 'dataset_versions_draft_status');
  pgm.dropColumn(VERSIONS, ['updated_at', 'revision', 'draft_status']);
};

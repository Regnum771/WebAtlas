import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Stage } from './types';
import { resolveStageFile } from './paths';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

/** sha256 of a file's content, hex. Injected wherever stage hashes are planned, so tests need no files. */
export type FileHasher = (absolutePath: string) => string;

export const sha256OfFile: FileHasher = (absolutePath) => {
  let content: Buffer;
  try {
    content = readFileSync(absolutePath);
  } catch (err) {
    throw new Error(`load-geojson: cannot read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return createHash('sha256').update(content).digest('hex');
};

/**
 * For PLANNING (the stage hash plan that status, verify, adopt and build all compute for every
 * dataset): a file that is not there hashes as `missing` instead of throwing. One absent seed file
 * then makes its own stage stale, and the load fails on it by name when it runs, instead of
 * taking every command down before it can say anything about the other datasets.
 */
export const plannedHashOfFile: FileHasher = (absolutePath) =>
  existsSync(absolutePath) ? sha256OfFile(absolutePath) : 'missing';

/** The content hash of each file of the stage, in the stage's order. */
export function stageFileHashes(stage: LoadStage, hash: FileHasher = sha256OfFile): string[] {
  return stage.files.map((f) => hash(resolveStageFile(f)));
}

/**
 * The `source` recorded on the ingest version: file names joined by `+`, then the sha256 of the
 * concatenated file hashes (spec §11). Two loads of the same bytes get the same source, which is
 * how an unchanged file creates no version.
 */
export function versionSource(stage: LoadStage, hash: FileHasher = sha256OfFile): string {
  const names = stage.files.map((f) => basename(f.file)).join('+');
  const digest = createHash('sha256').update(stageFileHashes(stage, hash).join('')).digest('hex');
  return `${names}@sha256:${digest}`;
}

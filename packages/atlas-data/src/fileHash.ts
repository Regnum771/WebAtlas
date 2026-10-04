import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

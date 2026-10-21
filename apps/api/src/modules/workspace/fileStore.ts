import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { finished, type Readable } from 'node:stream';
import { workspaceFilesDir } from '../../config/env';
import { FileTooLargeError } from '../../errors';

/*
 * The private file store: uploads, the COGs made from them and exports. workspace.files keeps
 * each file's path relative to the store root; every path is resolved through resolveInStore,
 * which refuses anything that would land outside the root.
 *
 * Nothing here deletes recursively: a file is removed on its own with unlink, and the empty
 * directories it leaves behind are kept.
 */

/** The store root, absolute. Read on every call (see workspaceFilesDir). */
export function storeRoot(): string {
  return path.resolve(workspaceFilesDir());
}

/** The absolute path of a store-relative path; throws if it is absolute or resolves outside the root. */
export function resolveInStore(relPath: string): string {
  if (!relPath || path.isAbsolute(relPath)) throw new Error(`Not a store-relative path: ${relPath}`);
  const root = storeRoot();
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  // '' is the root itself; a leading '..' segment or an absolute result (another drive) is outside.
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the file store: ${relPath}`);
  }
  return abs;
}

/**
 * Write `source` to a new file at `relPath` and return the bytes written. The file must not exist
 * yet. Above `maxBytes` the partial file is closed and unlinked and FileTooLargeError is thrown.
 *
 * The source is never destroyed: once the write stops it is left flowing so the rest drains. A
 * multipart file stream that is destroyed stalls its parser, and the request never completes.
 * A source that is destroyed by someone else before its end (an aborted upload) fails the write
 * the same way: the partial file is closed and unlinked, and the promise rejects.
 */
export async function writeStream(relPath: string, source: Readable, maxBytes: number): Promise<number> {
  const abs = resolveInStore(relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  // 'wx': the file must not exist. Opened before the stream so that a failure from here on is
  // known to concern a file this call created, and one that existed (EEXIST) is never unlinked.
  const handle = await open(abs, 'wx');
  const out = handle.createWriteStream();
  let bytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        source.resume(); // drain what is left; data after this is ignored
        reject(err);
      };
      out.on('error', fail);
      // A source error, or a source destroyed without one before its end (a client that
      // disconnects mid-upload: multipart's cleanup destroys the file stream, which then emits only
      // 'close'), fails the write: ERR_STREAM_PREMATURE_CLOSE. finished() also reports a source
      // that was already destroyed before these listeners were attached (mkdir and open come first).
      finished(source, (err) => {
        if (err) fail(err);
      });
      source.on('data', (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) return fail(new FileTooLargeError());
        if (!out.write(chunk)) {
          source.pause();
          out.once('drain', () => source.resume());
        }
      });
      source.on('end', () => {
        if (settled) return;
        // 'close' comes after the descriptor is closed, so the file is complete on disk.
        out.once('close', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        out.end();
      });
    });
    return bytes;
  } catch (err) {
    // Close the descriptor before unlinking: on Windows an open file is not removed until closed.
    if (!out.closed) {
      await new Promise<void>((resolve) => {
        out.once('close', () => resolve());
        out.destroy();
      });
    }
    await unlinkInStore(relPath);
    throw err;
  }
}

/** Remove one file from the store. A missing file is not an error. Never recursive. */
export async function unlinkInStore(relPath: string): Promise<void> {
  const abs = resolveInStore(relPath);
  try {
    await unlink(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

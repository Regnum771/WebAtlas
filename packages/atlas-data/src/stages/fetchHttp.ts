import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { DATA_CACHE } from '../paths';

type FetchStage = Extract<Stage, { type: 'fetch-http' }>;
const PROGRESS_EVERY = 64 * 1024 * 1024;
/** Abort a download that has produced no data for this long. */
const IDLE_MS = 60_000;

/** `message (cause) (cause's cause)` — the chain undici hides behind "fetch failed". */
function describeError(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e !== undefined && e !== null && depth < 4; depth++) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg && !parts.includes(msg)) parts.push(msg);
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.length ? parts[0] + parts.slice(1).map((p) => ` (${p})`).join('') : 'unknown error';
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Download `stage.url` into `<cache>/<stage.into>` (spec §8).
 * - Written to `<target>.part` and renamed on completion: an interrupted download can never be
 *   taken for a finished one, and the .part is removed on any failure.
 * - A download that receives no data for `idleMs` is aborted (a stalled server must not hang the
 *   build forever); the .part is removed as for any other failure.
 * - A declared sha256 is checked BEFORE the rename, so a mismatch leaves the previous file intact.
 * - An existing file is reused (no request) only when it satisfies the pin (or there is none),
 *   its `<target>.source` sidecar names exactly `stage.url`, and — for an UNPINNED source — the
 *   dataset is not forced. A file matching its declared sha256 is reused even when forced: it
 *   cannot be stale, so forcing re-runs only the later stages. The sidecar guarantees the recorded
 *   `<hash> <url>` pair is one that was really fetched: a changed URL with the same `into`
 *   downloads again rather than pairing the new URL with an old file's hash. An unpinned source
 *   is refreshed with --force; a pinned one (the basemap, spec C-10) by changing its url and
 *   sha256 in the descriptor.
 */
export async function executeFetchHttp(
  _pool: Pool,
  stage: FetchStage,
  ctx: StageContext,
  cacheDir: string = DATA_CACHE,
  idleMs: number = IDLE_MS
): Promise<StageResult> {
  const root = resolve(cacheDir);
  const target = resolve(root, stage.into);
  if (!target.startsWith(root + sep)) throw new Error(`fetch-http: "${stage.into}" escapes data/cache`);
  await mkdir(dirname(target), { recursive: true });

  const sidecar = `${target}.source`;
  // Forcing re-downloads only an unpinned source. A file that matches its declared sha256 cannot
  // be stale, so a forced dataset reuses it and only its later stages re-run (Task 12: forcing
  // the pinned basemap re-downloaded 720 MB that was already in the cache).
  if (existsSync(target) && !(ctx.forced && !stage.sha256)) {
    const source = existsSync(sidecar) ? (await readFile(sidecar, 'utf8')).trim() : null;
    if (source !== stage.url) {
      ctx.log(`[${ctx.datasetId}] ${stage.into} was not fetched from this URL; downloading again`);
    } else {
      const have = await sha256File(target);
      if (!stage.sha256 || have === stage.sha256) {
        ctx.log(
          ctx.forced
            ? `[${ctx.datasetId}] ${stage.into} matches its pin; reused although forced`
            : `[${ctx.datasetId}] ${stage.into} already present (sha256 ${have.slice(0, 12)})`
        );
        return { summary: `sha256:${have} ${stage.url} (reused)` };
      }
      ctx.log(`[${ctx.datasetId}] ${stage.into} does not match its pin; downloading again`);
    }
  }

  const part = `${target}.part`;
  const abort = new AbortController();
  let idled = false;
  let idleTimer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idled = true;
      abort.abort();
    }, idleMs);
  };
  const idleError = (): Error => {
    const seconds = idleMs < 10_000 ? (idleMs / 1000).toFixed(1) : String(Math.round(idleMs / 1000));
    return new Error(`fetch-http: no data from ${stage.url} for ${seconds} s — aborted`);
  };
  try {
    arm();
    const res = await fetch(stage.url, { signal: abort.signal });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`fetch-http: GET ${stage.url} returned ${res.status}`);
    }

    const total = Number(res.headers.get('content-length')) || 0;
    const hash = createHash('sha256');
    let bytes = 0;
    let nextReport = PROGRESS_EVERY;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        arm();
        hash.update(chunk);
        bytes += chunk.length;
        if (bytes >= nextReport) {
          const mb = Math.round(bytes / 1024 / 1024);
          const pct = total ? ` (${Math.min(100, Math.round((bytes / total) * 100))}%)` : '';
          ctx.log(`[${ctx.datasetId}] downloaded ${mb} MB${pct}`);
          nextReport += PROGRESS_EVERY;
        }
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream),
      meter,
      createWriteStream(part),
      { signal: abort.signal }
    );

    const got = hash.digest('hex');
    if (stage.sha256 && got !== stage.sha256) {
      throw new Error(`fetch-http: sha256 mismatch for ${stage.url}: expected ${stage.sha256}, got ${got}`);
    }
    // A crash between the rename and the sidecar write must never pair the new file with the
    // OLD url's sidecar (Plan A final review). With the sidecar gone first, a crash there just
    // means the next run re-downloads.
    await rm(sidecar, { force: true });
    await rename(part, target);
    await writeFile(sidecar, stage.url, 'utf8');
    return { summary: `sha256:${got} ${stage.url}` };
  } catch (err) {
    if (idled) throw idleError();
    if (err instanceof Error && err.message.startsWith('fetch-http:')) throw err;
    // undici reports every network failure as a bare "fetch failed" and keeps the reason in
    // `cause`. Task 12 met exactly that: Geofabrik's `latest` URLs 301-looping, shown as
    // "fetch failed" with no URL.
    throw new Error(`fetch-http: GET ${stage.url} failed: ${describeError(err)}`, { cause: err });
  } finally {
    clearTimeout(idleTimer);
    await rm(part, { force: true });
  }
}

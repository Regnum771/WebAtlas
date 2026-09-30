import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
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

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Download `stage.url` into `<cache>/<stage.into>` (spec §8).
 * - Written to `<target>.part` and renamed on completion: an interrupted download can never be
 *   taken for a finished one, and the .part is removed on any failure.
 * - A declared sha256 is checked BEFORE the rename, so a mismatch leaves the previous file intact.
 * - An existing file is reused (no request) when it satisfies the pin, or when there is no pin,
 *   unless the dataset is forced. Refreshing an unpinned `latest` source therefore takes --force
 *   (spec C-10); the fetched hash is always recorded so machines' downloads are distinguishable.
 */
export async function executeFetchHttp(
  _pool: Pool,
  stage: FetchStage,
  ctx: StageContext,
  cacheDir: string = DATA_CACHE
): Promise<StageResult> {
  const root = resolve(cacheDir);
  const target = resolve(root, stage.into);
  if (!target.startsWith(root + sep)) throw new Error(`fetch-http: "${stage.into}" escapes data/cache`);
  await mkdir(dirname(target), { recursive: true });

  if (!ctx.forced && existsSync(target)) {
    const have = await sha256File(target);
    if (!stage.sha256 || have === stage.sha256) {
      ctx.log(`[${ctx.datasetId}] ${stage.into} already present (sha256 ${have.slice(0, 12)})`);
      return { summary: `${stage.url} sha256:${have}` };
    }
    ctx.log(`[${ctx.datasetId}] ${stage.into} does not match its pin; downloading again`);
  }

  const part = `${target}.part`;
  try {
    const res = await fetch(stage.url);
    if (!res.ok || !res.body) throw new Error(`fetch-http: GET ${stage.url} returned ${res.status}`);

    const hash = createHash('sha256');
    let bytes = 0;
    let nextReport = PROGRESS_EVERY;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        if (bytes >= nextReport) {
          ctx.log(`[${ctx.datasetId}] downloaded ${Math.round(bytes / 1024 / 1024)} MB`);
          nextReport += PROGRESS_EVERY;
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), meter, createWriteStream(part));

    const got = hash.digest('hex');
    if (stage.sha256 && got !== stage.sha256) {
      throw new Error(`fetch-http: sha256 mismatch for ${stage.url}: expected ${stage.sha256}, got ${got}`);
    }
    await rename(part, target);
    return { summary: `${stage.url} sha256:${got}` };
  } finally {
    await rm(part, { force: true });
  }
}

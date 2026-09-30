import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { executeFetchHttp } from './fetchHttp';

const BODY = Buffer.from('x'.repeat(100_000));
const SHA = createHash('sha256').update(BODY).digest('hex');
const pool = {} as Pool;
const ctx = (forced = false) => ({ datasetId: 'basemap', forced, log: () => {} });

let server: Server;
let base: string;
let cache: string;
let hits: number;
let mode: 'ok' | 'cut' | 'missing' | 'stall';

beforeEach(async () => {
  hits = 0;
  mode = 'ok';
  cache = await mkdtemp(join(tmpdir(), 'atlas-fetch-'));
  server = createServer((req, res) => {
    hits++;
    if (mode === 'missing') { res.writeHead(404).end('no'); return; }
    res.writeHead(200, { 'Content-Length': String(BODY.length) });
    if (mode === 'stall') {
      res.write(BODY.subarray(0, 1000)); // headers + a few bytes, then silence
      return;
    }
    if (mode === 'cut') {
      res.write(BODY.subarray(0, 1000));
      setTimeout(() => req.socket.destroy(), 20); // die mid-body
      return;
    }
    res.end(BODY);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // So the "interrupted" test's readdir has a directory to read even if the executor failed early.
  await mkdir(join(cache, 'basemap'), { recursive: true });
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(cache, { recursive: true, force: true });
});

const stage = (over: Record<string, unknown> = {}) =>
  ({ type: 'fetch-http' as const, url: `${base}/a.zip`, into: 'basemap/a.zip', ...over });

describe('fetch-http', () => {
  it('downloads into the cache and records the content hash', async () => {
    const r = await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(r.summary).toBe(`sha256:${SHA} ${base}/a.zip`);
    expect(await readFile(join(cache, 'basemap/a.zip'))).toEqual(BODY);
  });

  it('an interrupted download leaves neither the target nor a .part file', async () => {
    mode = 'cut';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache)).rejects.toThrow();
    expect(existsSync(join(cache, 'basemap/a.zip'))).toBe(false);
    expect(await readdir(join(cache, 'basemap'))).toEqual([]);
  });

  it('aborts a stalled download after the idle timeout, leaving no target and no .part', async () => {
    mode = 'stall';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache, 200)).rejects.toThrow(
      /fetch-http: no data from .*\/a\.zip for [\d.]+ s — aborted/
    );
    expect(existsSync(join(cache, 'basemap/a.zip'))).toBe(false);
    expect(await readdir(join(cache, 'basemap'))).toEqual([]);
  });

  it('reports sub-second idle timeouts with one decimal, not "0 s"', async () => {
    mode = 'stall';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache, 200)).rejects.toThrow(/for 0\.2 s/);
  });

  it('a sha256 mismatch fails before the rename and keeps the previous file', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    await writeFile(join(cache, 'basemap/a.zip'), 'previous');
    const pinned = stage({ sha256: 'f'.repeat(64) });
    await expect(executeFetchHttp(pool, pinned, ctx(true), cache)).rejects.toThrow(/sha256 mismatch/);
    expect(await readFile(join(cache, 'basemap/a.zip'), 'utf8')).toBe('previous');
  });

  it('an existing file is reused without a request, unless forced', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(true), cache);
    expect(hits).toBe(2);
  });

  it('records the source URL in a sidecar after a successful download', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(await readFile(join(cache, 'basemap/a.zip.source'), 'utf8')).toBe(`${base}/a.zip`);
  });

  it('reuse says so in the summary, hash first', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    const r = await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(r.summary).toBe(`sha256:${SHA} ${base}/a.zip (reused)`);
  });

  it('an existing file whose sidecar names a different URL is re-downloaded', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    const moved = stage({ url: `${base}/b.zip` });
    const r = await executeFetchHttp(pool, moved, ctx(), cache);
    expect(hits).toBe(2);
    expect(r.summary).toBe(`sha256:${SHA} ${base}/b.zip`);
    expect(await readFile(join(cache, 'basemap/a.zip.source'), 'utf8')).toBe(`${base}/b.zip`);
  });

  it('an existing file with no sidecar is re-downloaded', async () => {
    await writeFile(join(cache, 'basemap/a.zip'), 'orphan');
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    expect(await readFile(join(cache, 'basemap/a.zip'))).toEqual(BODY);
  });

  it('an existing file that fails its pin is re-downloaded', async () => {
    await writeFile(join(cache, 'stale.zip'), 'stale');
    await writeFile(join(cache, 'stale.zip.source'), `${base}/a.zip`);
    await executeFetchHttp(pool, stage({ into: 'stale.zip', sha256: SHA }), ctx(), cache);
    expect(hits).toBe(1);
    expect(await readFile(join(cache, 'stale.zip'))).toEqual(BODY);
  });

  it('fails on a non-2xx response', async () => {
    mode = 'missing';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache)).rejects.toThrow(/404/);
  });

  it('refuses a path that escapes the cache even if validation was bypassed', async () => {
    await expect(executeFetchHttp(pool, stage({ into: '../escape.zip' }), ctx(), cache)).rejects.toThrow(/escapes/);
  });
});

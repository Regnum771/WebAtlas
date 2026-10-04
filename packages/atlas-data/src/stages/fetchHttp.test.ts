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
let mode: 'ok' | 'cut' | 'missing' | 'stall' | 'loop';

beforeEach(async () => {
  hits = 0;
  mode = 'ok';
  cache = await mkdtemp(join(tmpdir(), 'atlas-fetch-'));
  server = createServer((req, res) => {
    hits++;
    if (mode === 'missing') { res.writeHead(404).end('no'); return; }
    // What download.geofabrik.de answered for every *-latest* file on 2026-09-30 (Task 12): a 301 to
    // the same path plus a slash, which 301s to itself again.
    if (mode === 'loop') {
      const path = req.url!.endsWith('/') ? req.url! : `${req.url}/`;
      res.writeHead(301, { Location: path }).end();
      return;
    }
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

  it('an existing unpinned file is reused without a request, unless forced', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(true), cache);
    expect(hits).toBe(2);
  });

  it('an existing file that matches its pin is reused even when forced: it cannot be stale', async () => {
    const pinned = stage({ sha256: SHA });
    await executeFetchHttp(pool, pinned, ctx(), cache);
    expect(hits).toBe(1);
    const logged: string[] = [];
    const r = await executeFetchHttp(pool, pinned, { datasetId: 'basemap', forced: true, supersedeEdits: false, log: (l: string) => logged.push(l) }, cache);
    expect(hits).toBe(1);
    expect(r.summary).toBe(`sha256:${SHA} ${base}/a.zip (reused)`);
    expect(logged).toEqual(['[basemap] basemap/a.zip matches its pin; reused although forced']);
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

  it('a network failure names the URL and the underlying cause, not just "fetch failed"', async () => {
    mode = 'loop';
    const err = await executeFetchHttp(pool, stage(), ctx(), cache).then(() => null, (e: unknown) => e as Error);
    expect(err?.message).toBe(`fetch-http: GET ${base}/a.zip failed: fetch failed (redirect count exceeded)`);
    expect(await readdir(join(cache, 'basemap'))).toEqual([]);
  });

  describe('supersedes: earlier downloads this one replaces', () => {
    const pinned = (over: Record<string, unknown> = {}) =>
      stage({ url: `${base}/v-261001.zip`, into: 'basemap/v-261001.zip', sha256: SHA, supersedes: String.raw`^v-\d{6}\.zip$`, ...over });
    const old = async (): Promise<void> => {
      for (const f of ['v-260901.zip', 'v-260901.zip.source', 'v-260801.zip.part', 'other.zip', 'other.zip.source']) {
        await writeFile(join(cache, 'basemap', f), 'old');
      }
    };

    it('removes them, with sidecars and part files, once the new file is in place', async () => {
      await old();
      const lines: string[] = [];
      await executeFetchHttp(pool, pinned(), { ...ctx(), log: (l: string) => lines.push(l) }, cache);
      // The 260801 part file stays: no file of that name was ever completed, so nothing matched.
      expect((await readdir(join(cache, 'basemap'))).sort()).toEqual(
        ['other.zip', 'other.zip.source', 'v-260801.zip.part', 'v-261001.zip', 'v-261001.zip.source']);
      expect(lines.join('\n')).toMatch(/removed v-260901\.zip from the cache: superseded by v-261001\.zip/);
    });

    it('also when the file was already there: that is the run after a pin moved back and forth', async () => {
      await executeFetchHttp(pool, pinned(), ctx(), cache);
      await old();
      await executeFetchHttp(pool, pinned(), ctx(), cache);
      expect(hits).toBe(1);
      expect(await readdir(join(cache, 'basemap'))).not.toContain('v-260901.zip');
    });

    it('keeps them when the download fails: the old copy is the only one that works', async () => {
      await old();
      mode = 'missing';
      await expect(executeFetchHttp(pool, pinned(), ctx(), cache)).rejects.toThrow(/404/);
      expect(await readdir(join(cache, 'basemap'))).toContain('v-260901.zip');
    });

    it('never removes the stage\'s own sidecars, whatever the pattern says', async () => {
      await old();
      await executeFetchHttp(pool, pinned({ supersedes: '.*' }), ctx(), cache);
      expect((await readdir(join(cache, 'basemap'))).sort()).toEqual(['v-261001.zip', 'v-261001.zip.source']);
    });

    it('matches whole file names: an alternation cannot widen it', async () => {
      await old();
      await executeFetchHttp(pool, pinned({ supersedes: String.raw`v-\d{6}\.zip|other` }), ctx(), cache);
      // `other` alone would match only a file named exactly "other".
      expect(await readdir(join(cache, 'basemap'))).toContain('other.zip');
      expect(await readdir(join(cache, 'basemap'))).not.toContain('v-260901.zip');
    });

    it('a file that cannot be removed is reported and left; the stage still succeeds', async () => {
      await old();
      await mkdir(join(cache, 'basemap', 'v-260701.zip'));
      await writeFile(join(cache, 'basemap', 'v-260701.zip', 'inside'), 'x');
      const lines: string[] = [];
      await executeFetchHttp(pool, pinned(), { ...ctx(), log: (l: string) => lines.push(l) }, cache);
      expect(lines.join('\n')).toMatch(/could not remove v-260701\.zip from the cache .*left in place/);
      expect(await readdir(join(cache, 'basemap'))).not.toContain('v-260901.zip');
    });

    it('removes nothing without it', async () => {
      await old();
      await executeFetchHttp(pool, pinned({ supersedes: undefined }), ctx(), cache);
      expect(await readdir(join(cache, 'basemap'))).toContain('v-260901.zip');
    });
  });

  it('refuses a path that escapes the cache even if validation was bypassed', async () => {
    await expect(executeFetchHttp(pool, stage({ into: '../escape.zip' }), ctx(), cache)).rejects.toThrow(/escapes/);
  });
});

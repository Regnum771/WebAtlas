import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildTools, ENV_FILES, migrate, preflight, startStack, UpError, waitReady, type UpConfig, type UpSystem } from './up';

const GiB = 1024 ** 3;

function fakeSystem(over: {
  exec?: (file: string, args: string[]) => number;
  free?: number;
  existing?: string[];
  statuses?: number[];
} = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const copies: Array<[string, string]> = [];
  let clock = 0;
  const statuses = [...(over.statuses ?? [200])];
  const sys: UpSystem = {
    async exec(file, args) {
      calls.push([file, ...args].join(' '));
      return { code: over.exec ? over.exec(file, args) : 0, tail: ['last line'] };
    },
    async freeBytes() { return over.free ?? 50 * GiB; },
    exists: (p) => (over.existing ?? []).some((e) => p.endsWith(e)),
    copy: (a, b) => { copies.push([a, b]); },
    async status() { return statuses.length > 1 ? statuses.shift()! : statuses[0]; },
    async sleep(ms) { clock += ms; },
    now: () => clock,
    log: (l) => { logs.push(l); },
  };
  return { sys, calls, logs, copies };
}

const cfg: UpConfig = {
  repoRoot: '/repo',
  cacheDir: '/repo/packages/atlas-data/data/cache',
  nodeVersion: '22.13.1',
  docker: ['compose', '-f', '/repo/infra/docker-compose.yml'],
  dockerEnv: {},
  npm: { file: '/usr/bin/node', args: ['/npm/bin/npm-cli.js'] },
  readyTimeoutMs: 10_000,
  pollMs: 2_000,
};
const gs = { url: 'http://localhost:8080/geoserver', user: 'admin', password: 'pw' };

describe('preflight (spec F-1, U-6, U-7)', () => {
  it('passes on a ready machine and states the expected downloads first', async () => {
    const f = fakeSystem({ existing: ENV_FILES });
    await preflight(f.sys, cfg);
    expect(f.logs.some((l) => /downloads about 1\.2 GB/.test(l))).toBe(true);
    expect(f.copies).toEqual([]);
  });

  it('refuses a Node other than 22', async () => {
    await expect(preflight(fakeSystem().sys, { ...cfg, nodeVersion: '20.11.0' })).rejects.toThrow(/Node 22 is required \(this is Node 20\.11\.0\)/);
  });

  it('says Docker is not running when `docker info` fails — before anything else runs', async () => {
    const f = fakeSystem({ exec: (file, args) => (args[0] === 'info' ? 1 : 0) });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/Docker is not running — start Docker Desktop/);
    expect(f.calls).toEqual(['docker info']);
  });

  it('requires Compose v2', async () => {
    const f = fakeSystem({ exec: (file, args) => (args[0] === 'compose' ? 1 : 0) });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/Docker Compose v2 is required/);
  });

  it('creates missing env files from their examples and says so', async () => {
    const f = fakeSystem({ existing: [] });
    await preflight(f.sys, cfg);
    expect(f.copies).toEqual([
      [join('/repo', 'infra', '.env.example'), join('/repo', 'infra', '.env')],
      [join('/repo', 'apps', 'api', '.env.example'), join('/repo', 'apps', 'api', '.env')],
    ]);
    expect(f.logs.filter((l) => l.startsWith('created '))).toHaveLength(2);
  });

  it('with one env file present, copies only the missing one', async () => {
    const f = fakeSystem({ existing: [ENV_FILES[0]] });
    await preflight(f.sys, cfg);
    expect(f.copies).toEqual([[join('/repo', 'apps', 'api', '.env.example'), join('/repo', 'apps', 'api', '.env')]]);
  });

  it('refuses below the free-space floor, with the number', async () => {
    const f = fakeSystem({ existing: ENV_FILES, free: 2 * GiB });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/only 2\.0 GB free .* needs at least 6 GB/);
  });
});

describe('startStack / buildTools / migrate', () => {
  it('bring up only db and geoserver, never down', async () => {
    const f = fakeSystem();
    await startStack(f.sys, cfg);
    await buildTools(f.sys, cfg);
    await migrate(f.sys, cfg);
    expect(f.calls).toEqual([
      'docker compose -f /repo/infra/docker-compose.yml up -d --no-recreate db geoserver',
      'docker compose -f /repo/infra/docker-compose.yml --profile tools build tools',
      '/usr/bin/node /npm/bin/npm-cli.js run migrate:up -w @webatlas/api',
    ]);
    expect(f.calls.join('\n')).not.toMatch(/\bdown\b/);
    expect(f.calls[0]).toContain('--no-recreate');
  });

  it('carry the failing command output in the error', async () => {
    const f = fakeSystem({ exec: () => 1 });
    await expect(startStack(f.sys, cfg)).rejects.toThrow(/last line/);
    await expect(migrate(f.sys, cfg)).rejects.toBeInstanceOf(UpError);
  });
});

describe('waitReady (spec §4 stack lifecycle)', () => {
  it('checks the database over TCP, not the init server socket', async () => {
    const f = fakeSystem();
    await waitReady(f.sys, cfg, gs);
    expect(f.calls[0]).toBe('docker compose -f /repo/infra/docker-compose.yml exec -T db pg_isready -h localhost');
  });

  it('gives up on a database that never answers, with its last output', async () => {
    const f = fakeSystem({ exec: () => 1 });
    await expect(waitReady(f.sys, cfg, gs)).rejects.toThrow(/the database did not become ready within 10 s[\s\S]*last line/);
  });

  it('polls the database, then GeoServer REST, until both answer', async () => {
    let dbAttempts = 0;
    const f = fakeSystem({ exec: () => (++dbAttempts < 3 ? 1 : 0), statuses: [0, 503, 200] });
    await waitReady(f.sys, cfg, gs);
    expect(dbAttempts).toBe(3);
    expect(f.logs).toEqual(['db ready', 'geoserver ready']);
  });

  it('gives up with the last status when GeoServer never answers', async () => {
    const f = fakeSystem({ statuses: [503] });
    await expect(waitReady(f.sys, cfg, gs)).rejects.toThrow(/GeoServer did not answer within 10 s \(last status 503\)/);
  });

  it('names a credentials mismatch instead of waiting it out', async () => {
    const f = fakeSystem({ statuses: [401] });
    await expect(waitReady(f.sys, cfg, gs)).rejects.toThrow(/GEOSERVER_ADMIN_PASSWORD in apps\/api\/\.env must match infra\/\.env/);
  });
});

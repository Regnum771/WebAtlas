import { join, resolve } from 'node:path';

export interface ExecResult {
  code: number | null;
  tail: string[];
}

/** Everything atlas:up touches outside itself, so the orchestration is testable without Docker. */
export interface UpSystem {
  /** Start a process (never through a shell). `quiet` suppresses its output. Never rejects. */
  exec(file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; quiet?: boolean }): Promise<ExecResult>;
  /** Bytes free on the filesystem that holds `path`, which may not exist yet. */
  freeBytes(path: string): Promise<number>;
  exists(path: string): boolean;
  copy(src: string, dst: string): void;
  /** Status of an authenticated GET, or 0 when nothing answered. Never rejects. */
  status(url: string, auth: { user: string; password: string }): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface UpConfig {
  repoRoot: string;
  cacheDir: string;
  nodeVersion: string;
  /** `['compose', '-f', <file>]` (composeArgs). */
  docker: string[];
  /** The compose file itself (composeFile), to tell this checkout's stack from another's. */
  composeFile: string;
  /** ATLAS_SHARED_STACK=1: building into a stack another checkout started is intended. */
  allowSharedStack?: boolean;
  /** composeEnv(): infra/.env governs interpolation. */
  dockerEnv: NodeJS.ProcessEnv;
  /** node + npm-cli.js (npmCli), so `npm` never goes through a shell. */
  npm: { file: string; args: string[] };
  minFreeBytes?: number;
  readyTimeoutMs?: number;
  pollMs?: number;
}

export class UpError extends Error {}

const GiB = 1024 ** 3;

/** The env files a fresh clone needs, created from their committed examples. */
export const ENV_FILES = [join('infra', '.env'), join('apps', 'api', '.env')];

function failed(what: string, r: ExecResult): UpError {
  return new UpError([what, ...r.tail.map((l) => `  | ${l}`)].join('\n'));
}

/** Everything that can be known to fail before anything runs (spec F-1 step 1, U-1, U-6, U-7). */
export async function preflight(sys: UpSystem, cfg: UpConfig): Promise<void> {
  if (Number(cfg.nodeVersion.split('.')[0]) !== 22) {
    throw new UpError(`Node 22 is required (this is Node ${cfg.nodeVersion}) — see "engines" in package.json`);
  }
  if ((await sys.exec('docker', ['info'], { env: cfg.dockerEnv, quiet: true })).code !== 0) {
    throw new UpError('Docker is not running — start Docker Desktop (or the docker service), then run npm run atlas:up again');
  }
  if ((await sys.exec('docker', ['compose', 'version'], { env: cfg.dockerEnv, quiet: true })).code !== 0) {
    throw new UpError('Docker Compose v2 is required: `docker compose version` failed');
  }
  for (const rel of ENV_FILES) {
    const file = join(cfg.repoRoot, rel);
    if (!sys.exists(file)) {
      sys.copy(`${file}.example`, file);
      sys.log(`created ${rel} from ${rel}.example (local development defaults — change them for anything shared)`);
    }
  }
  const min = cfg.minFreeBytes ?? 6 * GiB;
  const free = await sys.freeBytes(cfg.cacheDir);
  if (free < min) {
    throw new UpError(
      `only ${(free / GiB).toFixed(1)} GB free for ${cfg.cacheDir}; the first build needs at least ${Math.round(min / GiB)} GB ` +
        '(downloads, intermediates and the database volume)'
    );
  }
  sys.log(
    'first build: downloads about 1.2 GB (OpenStreetMap extract 720 MB, FABDEM tiles 512 MB) and takes a while — ' +
      'see README "Getting started" for the measured time. Re-running resumes; finished work is skipped.'
  );
}

const CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';

/** The same file, however it was spelled: Windows paths differ in case and separators. */
function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string): string => {
    const r = resolve(p);
    return platform === 'win32' ? r.replace(/\//g, '\\').toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/**
 * A second clone keeps the compose project name, so its `docker compose` talks to the FIRST
 * clone's containers, and its fresh apps/api/.env points at the same ports. atlas:up there would
 * migrate and build into the other checkout's database without a word. Docker records which
 * compose file created each container; if this project's containers came from another file, stop.
 */
export async function assertOwnStack(sys: UpSystem, cfg: UpConfig): Promise<void> {
  if (cfg.allowSharedStack) return;
  const r = await sys.exec(
    'docker',
    [...cfg.docker, 'ps', '-a', '--format', `{{.Label "${CONFIG_FILES_LABEL}"}}`],
    { env: cfg.dockerEnv, quiet: true }
  );
  // No answer is no evidence: startStack reports a Docker that really cannot run compose.
  if (r.code !== 0) return;
  // A project started with several -f files lists them comma-separated; this command uses one.
  const other = r.tail
    .flatMap((line) => line.split(','))
    .map((f) => f.trim())
    .find((f) => /\.ya?ml$/i.test(f) && !samePath(f, cfg.composeFile));
  if (!other) return;
  throw new UpError(
    [
      'this compose project is already running from another checkout:',
      `  its containers were created from ${other}`,
      `  this checkout uses              ${cfg.composeFile}`,
      'atlas:up here would migrate and build into that stack. For a separate stack, give this checkout its own',
      'project name and ports (docs/runbooks/README.md, "A second stack on one machine"). If sharing the stack is',
      'what you want (for example the repository was moved), run it again with ATLAS_SHARED_STACK=1.',
    ].join('\n')
  );
}

/** What atlas:up prints last. Pure, so every ending is tested. */
export function closingLines(run: {
  ok: boolean;
  /** The arguments as the user typed them. */
  argv: string[];
  /** The same without --only/--except/--force/--supersede-edits: the command for the whole atlas. */
  composeArgv: string[];
  selected: string[];
  all: string[];
}): string[] {
  const command = (args: string[]): string => (args.length ? `npm run atlas:up -- ${args.join(' ')}` : 'npm run atlas:up');
  if (!run.ok) {
    return ['', `atlas:up did not complete — fix the error above and run ${command(run.argv)} again (finished work is skipped)`];
  }
  if (run.selected.length < run.all.length) {
    const left = run.all.filter((id) => !run.selected.includes(id));
    return [
      '',
      `built and verified ${run.selected.length} of ${run.all.length} datasets; not built by this run: ${left.join(', ')}`,
      `the atlas is complete only after ${command(run.composeArgv)}   (npm run atlas:status shows what is there)`,
    ];
  }
  return [
    '',
    'next: create an administrator (there is no default login):',
    '  npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"',
    'then: npm run dev -w @webatlas/api   and   npm run dev:web',
  ];
}

/** Up, never down (spec §4): starting an already-running stack is a no-op, and no volume is ever touched. */
export async function startStack(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec('docker', [...cfg.docker, 'up', '-d', '--no-recreate', 'db', 'geoserver'], { env: cfg.dockerEnv });
  if (r.code !== 0) throw failed('could not start the stack (docker compose up -d --no-recreate db geoserver):', r);
}

/** Readiness is polled, not assumed (spec §4): db accepting connections, then GeoServer's REST API answering. */
export async function waitReady(
  sys: UpSystem,
  cfg: UpConfig,
  gs: { url: string; user: string; password: string }
): Promise<void> {
  const timeout = cfg.readyTimeoutMs ?? 180_000;
  const poll = cfg.pollMs ?? 2_000;
  const deadline = sys.now() + timeout;

  // -h localhost: TCP. On first boot the image's init server listens on the unix socket only.
  for (;;) {
    const r = await sys.exec('docker', [...cfg.docker, 'exec', '-T', 'db', 'pg_isready', '-h', 'localhost'], { env: cfg.dockerEnv, quiet: true });
    if (r.code === 0) break;
    if (sys.now() >= deadline) throw new UpError([`the database did not become ready within ${timeout / 1000} s`, ...r.tail.map((l) => `  | ${l}`)].join('\n'));
    await sys.sleep(poll);
  }
  sys.log('db ready');

  for (;;) {
    const status = await sys.status(`${gs.url}/rest/about/version.json`, gs);
    if (status === 200) break;
    if (status === 401) {
      throw new UpError('GeoServer rejected the admin credentials — GEOSERVER_ADMIN_PASSWORD in apps/api/.env must match infra/.env');
    }
    if (sys.now() >= deadline) {
      throw new UpError(`GeoServer did not answer within ${timeout / 1000} s (last status ${status})`);
    }
    await sys.sleep(poll);
  }
  sys.log('geoserver ready');
}

export async function buildTools(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec('docker', [...cfg.docker, '--profile', 'tools', 'build', 'tools'], { env: cfg.dockerEnv });
  if (r.code !== 0) throw failed('could not build the atlas-tools image:', r);
}

export async function migrate(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec(cfg.npm.file, [...cfg.npm.args, 'run', 'migrate:up', '-w', '@webatlas/api']);
  if (r.code !== 0) throw failed('migrations failed (npm run migrate:up -w @webatlas/api):', r);
}

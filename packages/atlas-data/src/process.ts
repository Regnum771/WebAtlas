import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Each stored tail line is capped at this many characters. */
const TAIL_LINE_MAX = 500;

export interface RunProcessOptions {
  /** Prefix for every line, usually the dataset id: `[label] …`. */
  label: string;
  log: (line: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Silence longer than this prints `[label] … still running (N s)`. Default 30 s (NFR-4). */
  heartbeatMs?: number;
  /** How many trailing lines to keep for the failure message. Default 20 (U-3). */
  tailLines?: number;
}

export interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  tail: string[];
}

/**
 * Start `file` with `args` and NO shell (NFR-2): arguments reach the process exactly as given,
 * so nothing in an argv can be re-parsed as `;`, `&&` or a substitution. Resolves with the exit
 * code whatever it is — deciding what a non-zero exit means is the caller's job. Rejects only
 * when the process cannot be started at all.
 */
export function runProcess(file: string, args: string[], opts: RunProcessOptions): Promise<ProcessOutcome> {
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const tailMax = opts.tailLines ?? 20;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tail: string[] = [];
    const child = spawn(file, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let timer: NodeJS.Timeout;
    const beat = (): void => {
      opts.log(`[${opts.label}] … still running (${Math.round((Date.now() - started) / 1000)} s)`);
      timer = setTimeout(beat, heartbeatMs);
    };
    timer = setTimeout(beat, heartbeatMs);

    const onLine = (line: string): void => {
      // One pathological line (a progress bar, minified JSON) must not bloat the failure message.
      tail.push(line.length > TAIL_LINE_MAX ? `${line.slice(0, TAIL_LINE_MAX)}…` : line);
      if (tail.length > tailMax) tail.shift();
      opts.log(`[${opts.label}] ${line}`);
      clearTimeout(timer);
      timer = setTimeout(beat, heartbeatMs);
    };
    createInterface({ input: child.stdout! }).on('line', onLine);
    createInterface({ input: child.stderr! }).on('line', onLine);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`[${opts.label}] cannot start ${file}: ${err.message} (argv: ${JSON.stringify(args)})`, { cause: err }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, tail });
    });
  });
}

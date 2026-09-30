import { copyFileSync, existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UpSystem } from '../up';
import { runProcess } from '../process';
import { REPO_ROOT } from '../paths';

export function realSystem(label = 'up'): UpSystem {
  return {
    async exec(file, args, opts = {}) {
      try {
        const r = await runProcess(file, args, {
          label,
          log: opts.quiet ? () => {} : (l) => console.log(l),
          env: opts.env,
          cwd: REPO_ROOT,
        });
        return { code: r.code, tail: r.tail };
      } catch (err) {
        // runProcess rejects only when the executable cannot start (e.g. docker not installed).
        return { code: null, tail: [err instanceof Error ? err.message : String(err)] };
      }
    },
    async freeBytes(path) {
      let p = path;
      while (!existsSync(p)) {
        const up = dirname(p);
        if (up === p) break;
        p = up;
      }
      const s = await statfs(p);
      return s.bavail * s.bsize;
    },
    exists: existsSync,
    copy: (src, dst) => copyFileSync(src, dst),
    async status(url, auth) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.password}`).toString('base64') },
          signal: AbortSignal.timeout(5_000),
        });
        await res.body?.cancel();
        return res.status;
      } catch {
        return 0;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.log(line),
  };
}

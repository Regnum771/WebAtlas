import { describe, it, expect } from 'vitest';
import { runProcess } from './process';

const node = process.execPath;

function collector() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

describe('runProcess', () => {
  it('streams each output line with the label prefix and reports the exit code', async () => {
    const c = collector();
    const out = await runProcess(node, ['-e', 'console.log("a"); console.error("b"); process.exit(3)'], {
      label: 'rivers', log: c.log,
    });
    expect(out.code).toBe(3);
    expect(c.lines).toEqual(expect.arrayContaining(['[rivers] a', '[rivers] b']));
  });

  it('keeps only the last N lines as the tail', async () => {
    const out = await runProcess(node, ['-e', 'for (let i = 1; i <= 30; i++) console.log("l" + i)'], {
      label: 't', log: () => {}, tailLines: 20,
    });
    expect(out.tail).toHaveLength(20);
    expect(out.tail[0]).toBe('l11');
    expect(out.tail[19]).toBe('l30');
  });

  it('passes arguments literally — no shell ever re-parses them (NFR-2)', async () => {
    const c = collector();
    await runProcess(node, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a;b', '&&', '$(x)'], {
      label: 't', log: c.log,
    });
    expect(c.lines).toContain('[t] ["a;b","&&","$(x)"]');
  });

  it('prints a heartbeat while the process is silent', async () => {
    const c = collector();
    await runProcess(node, ['-e', 'setTimeout(() => {}, 400)'], { label: 'dem', log: c.log, heartbeatMs: 100 });
    expect(c.lines.some((l) => /^\[dem\] … still running \(\d+ s\)$/.test(l))).toBe(true);
  });

  it('rejects when the executable cannot be started', async () => {
    await expect(runProcess('definitely-not-a-real-binary-xyz', [], { label: 't', log: () => {} })).rejects.toThrow();
  });
});

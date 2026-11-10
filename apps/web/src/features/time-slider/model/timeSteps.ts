/** Sorted, unique ISO steps from several lists (ISO UTC strings of one shape sort as text; compare by instant to be safe). */
export function unionSteps(lists: string[][]): string[] {
  const byInstant = new Map<number, string>();
  for (const list of lists) {
    for (const s of list) {
      const t = Date.parse(s);
      if (Number.isFinite(t) && !byInstant.has(t)) byInstant.set(t, s);
    }
  }
  return [...byInstant.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/** The latest step at or before `time`; null when `time` is before the first step (or there are none). */
export function stepAtOrBefore(steps: string[], time: string): string | null {
  const t = Date.parse(time);
  let best: string | null = null;
  let bestT = -Infinity;
  for (const s of steps) {
    const st = Date.parse(s);
    if (st <= t && st > bestT) { best = s; bestT = st; }
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `dd/MM/yyyy HH:mm` in the browser's local time. */
export function formatStepLocal(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

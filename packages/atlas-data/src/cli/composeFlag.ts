/** `--compose <file>` or `--compose=<file>` is atlas:up's own; everything else is atlas:build's. */
export function takeCompose(argv: string[]): { compose?: string; rest: string[] } {
  const rest: string[] = [];
  let compose: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new Error('atlas:up: --compose requires a file');
      compose = v;
      i++;
    } else if (a.startsWith('--compose=')) {
      const v = a.slice('--compose='.length);
      if (v === '') throw new Error('atlas:up: --compose requires a file');
      compose = v;
    } else {
      rest.push(a);
    }
  }
  return { compose, rest };
}

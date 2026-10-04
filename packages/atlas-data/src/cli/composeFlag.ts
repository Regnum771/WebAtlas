import { resolve } from 'node:path';

/** `--compose <file>` or `--compose=<file>`, for the commands that start containers: atlas:up and atlas:build. */
export function takeCompose(argv: string[], command = 'atlas:up'): { compose?: string; rest: string[] } {
  const rest: string[] = [];
  let compose: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${command}: --compose requires a file`);
      compose = v;
      i++;
    } else if (a.startsWith('--compose=')) {
      const v = a.slice('--compose='.length);
      if (v === '') throw new Error(`${command}: --compose requires a file`);
      compose = v;
    } else {
      rest.push(a);
    }
  }
  return { compose, rest };
}

/**
 * Take `--compose` off the arguments and make it the compose file of every docker call of this
 * process (ATLAS_COMPOSE_FILE, see compose.ts). A relative path is relative to where the user ran
 * npm, not to the workspace npm changed into.
 */
export function applyCompose(
  argv: string[],
  command: string,
  env: NodeJS.ProcessEnv = process.env
): { compose?: string; rest: string[] } {
  const taken = takeCompose(argv, command);
  if (taken.compose) env.ATLAS_COMPOSE_FILE = resolve(env.INIT_CWD ?? process.cwd(), taken.compose);
  return taken;
}

/**
 * For the commands that take no arguments. They never start a container: they read DATABASE_URL and
 * GEOSERVER_URL. Accepting `--compose` there would suggest it chooses which stack they look at.
 */
export function unexpectedArgument(command: string, arg: string): string {
  return /^--compose(=|$)/.test(arg)
    ? `${command}: --compose has no effect here. This command does not use Docker: it looks at the stack that ` +
        'DATABASE_URL and GEOSERVER_URL point at (apps/api/.env).'
    : `${command}: unexpected argument "${arg}" (${command} takes no arguments)`;
}

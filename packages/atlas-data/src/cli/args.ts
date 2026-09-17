export interface BuildArgs {
  only: string[];
  except: string[];
}

const FLAGS = ['--only', '--except'] as const;
type Flag = (typeof FLAGS)[number];

function splitIds(flag: Flag, raw: string): string[] {
  const ids = raw.split(',').map((id) => id.trim());
  if (ids.some((id) => id.length === 0)) {
    throw new Error(`atlas:build: ${flag} contains an empty dataset id in "${raw}"`);
  }
  return ids;
}

/**
 * Parse atlas:build arguments. Fails closed: any malformed or unknown argument throws, because
 * a silently ignored --except turns "skip basemap" into "build everything".
 */
export function parseBuildArgs(argv: string[]): BuildArgs {
  const values: Partial<Record<Flag, string>> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const eq = FLAGS.find((flag) => token.startsWith(`${flag}=`));

    let flag: Flag;
    let value: string;

    if (eq) {
      flag = eq;
      value = token.slice(eq.length + 1);
    } else if ((FLAGS as readonly string[]).includes(token)) {
      flag = token as Flag;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`atlas:build: ${flag} requires a value`);
      }
      value = next;
      i++;
    } else {
      throw new Error(`atlas:build: unknown argument "${token}"`);
    }

    if (values[flag] !== undefined) {
      throw new Error(`atlas:build: ${flag} given more than once`);
    }
    values[flag] = value;
  }

  return {
    only: values['--only'] !== undefined ? splitIds('--only', values['--only']) : [],
    except: values['--except'] !== undefined ? splitIds('--except', values['--except']) : [],
  };
}

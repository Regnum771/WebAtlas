/**
 * Shapefile field names: a .dbf field name holds at most 10 characters, and two fields may not
 * share a name whatever their case. The API lists the names an export will cut before the user
 * downloads (the export preview), and the worker renames the fields with exactly this mapping,
 * so both read it from here.
 *
 * Rules, applied to the whole list at once:
 * - a name that fits (at most 10 characters, not yet taken) keeps itself; the first of two names
 *   that differ only in case keeps itself;
 * - any other name is cut to its first 10 characters;
 * - when that is taken, it becomes its first 8 characters, '_' and a counter from 1
 *   (`ten_cong_1`, `ten_cong_2`, ...); a counter of two digits or more takes characters from the
 *   prefix, so the name stays at 10 characters.
 *
 * Names that fit are reserved before any name is cut, so a cut name never takes the name of a
 * field that already fits.
 */

export const SHAPEFILE_FIELD_MAX = 10;

/** First `n` characters, by code point, so a surrogate pair is never split. */
function head(name: string, n: number): string {
  return Array.from(name).slice(0, n).join('');
}

function fits(name: string): boolean {
  return Array.from(name).length <= SHAPEFILE_FIELD_MAX;
}

export function shapefileFieldNames(names: string[]): Array<{ from: string; to: string }> {
  const taken = new Set<string>();
  const out: Array<string | null> = names.map((name) => {
    const key = name.toLowerCase();
    if (!fits(name) || taken.has(key)) return null;
    taken.add(key);
    return name;
  });

  for (let i = 0; i < names.length; i++) {
    if (out[i] !== null) continue;
    const name = names[i];
    let to = head(name, SHAPEFILE_FIELD_MAX);
    for (let n = 1; taken.has(to.toLowerCase()); n++) {
      const counter = `_${n}`;
      to = head(name, SHAPEFILE_FIELD_MAX - counter.length) + counter;
    }
    taken.add(to.toLowerCase());
    out[i] = to;
  }

  return names.map((from, i) => ({ from, to: out[i]! }));
}

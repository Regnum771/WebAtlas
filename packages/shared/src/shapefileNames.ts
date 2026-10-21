/**
 * Shapefile field names. A .dbf field name is at most 10 BYTES, and two fields may not share a
 * name whatever their case. Field names come from user data, often Vietnamese (`ngày_xây_dựng`),
 * where one letter can take three bytes in UTF-8; cut by characters, such a name would still be
 * too long, and GDAL would cut it again on its own, perhaps through the middle of a letter. The
 * API lists the names an export changes before the user downloads (the export preview), and the
 * worker renames the fields with exactly this mapping, so the preview matches the file only if
 * every name here is already short enough in bytes. Every name is therefore folded to ASCII
 * first, where one character is one byte.
 *
 * Rules, applied to the whole list at once:
 * - fold: diacritics removed (NFD, combining marks stripped), đ/Đ to d/D, and every character
 *   outside [A-Za-z0-9_] replaced by '_';
 * - a name that is already ASCII-safe, at most 10 characters and not yet taken keeps itself; the
 *   first of two names that differ only in case keeps itself;
 * - any other name becomes the first 10 characters of its folded form;
 * - when that is taken, it becomes the first 8 characters of its folded form, '_' and a counter
 *   from 1 (`ten_cong_1`, `ten_cong_2`, ...); a counter of two digits or more takes characters
 *   from the prefix, so the name stays at 10 characters.
 *
 * Unchanged names are reserved before any other is assigned, so a changed name never takes the
 * name of a field that already fits.
 */

export const SHAPEFILE_FIELD_MAX = 10;

/** The name in [A-Za-z0-9_] only: one byte per character. */
export function foldFieldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_]/g, '_');
}

export function shapefileFieldNames(names: string[]): Array<{ from: string; to: string }> {
  const taken = new Set<string>();
  const out: Array<string | null> = names.map((name) => {
    const key = name.toLowerCase();
    if (foldFieldName(name) !== name || name.length > SHAPEFILE_FIELD_MAX || taken.has(key)) return null;
    taken.add(key);
    return name;
  });

  for (let i = 0; i < names.length; i++) {
    if (out[i] !== null) continue;
    const folded = foldFieldName(names[i]);
    let to = folded.slice(0, SHAPEFILE_FIELD_MAX);
    for (let n = 1; taken.has(to.toLowerCase()); n++) {
      const counter = `_${n}`;
      to = folded.slice(0, SHAPEFILE_FIELD_MAX - counter.length) + counter;
    }
    taken.add(to.toLowerCase());
    out[i] = to;
  }

  return names.map((from, i) => ({ from, to: out[i]! }));
}

/** Pure helpers for the legacy style baseline: which properties are read, how elements are keyed, how two snapshots differ. */

const SIDES = ['top', 'right', 'bottom', 'left'];

export const PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  ...SIDES.map((s) => `margin-${s}`),
  ...SIDES.map((s) => `padding-${s}`),
  ...SIDES.map((s) => `border-${s}-width`),
  ...SIDES.map((s) => `border-${s}-style`),
  ...SIDES.map((s) => `border-${s}-color`),
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'text-decoration-line',
  'list-style-type',
  'vertical-align',
  'max-width',
  'cursor',
  'appearance',
];

/** Sorts the classes of a `tag.class.class` segment so class order never changes a key. */
function normalise(segment) {
  const [tag, ...classes] = segment.split('.');
  return [tag, ...classes.sort()].join('.');
}

/**
 * Key of an element from its path of `tag.class` segments. Identical paths are
 * told apart by order: the second gets `#2`, and so on. Text is never part of a key.
 */
export function elementKey(path, seen) {
  const base = path.map(normalise).join('>');
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}#${count}`;
}

/** Differences from `before` to `after`, one line each; empty when the snapshots agree. */
export function diffSnapshots(before, after) {
  const out = [];
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      out.push(`missing: ${key}`);
      continue;
    }
    const names = new Set([...Object.keys(before[key]), ...Object.keys(after[key])]);
    for (const name of names) {
      if (before[key][name] !== after[key][name]) {
        out.push(`${key}: ${name} ${before[key][name]} → ${after[key][name]}`);
      }
    }
  }
  for (const key of Object.keys(after)) {
    if (!(key in before)) out.push(`added: ${key}`);
  }
  return out;
}

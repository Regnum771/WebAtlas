/**
 * `q` as a LIKE pattern matching it anywhere, with its own wildcards (`%`, `_`) and the escape
 * character (`\`, LIKE's default) taken literally. Bind the result as a parameter.
 */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

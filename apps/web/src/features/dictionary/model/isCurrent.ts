/** Today's LOCAL date as YYYY-MM-DD (toISOString would give the UTC date, a day off near midnight in Vietnam). */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current means there is no end date, or the end date is still in the future. */
export function isCurrent(validTo?: string, today: string = localToday()): boolean {
  return !validTo || validTo > today;
}

export interface RainDay {
  /** The local date, YYYY-MM-DD. */
  date: string;
  /** Basin-mean rain that day. */
  mm: number;
}

/** The running total after each day. */
export function runningTotals(days: RainDay[]): number[] {
  let sum = 0;
  return days.map((d) => (sum += d.mm));
}

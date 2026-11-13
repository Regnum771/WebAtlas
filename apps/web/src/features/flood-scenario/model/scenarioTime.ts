const VN_OFFSET_H = 7;

/** Midnight hours, Vietnam time, for the day ticks. */
export function midnightHours(startTime: string, hours: number): number[] {
  const startH = (new Date(startTime).getUTCHours() + VN_OFFSET_H) % 24;
  return Array.from({ length: hours + 1 }, (_, h) => h).filter((h) => (startH + h) % 24 === 0);
}

export function dayLabel(startTime: string, h: number): string {
  const t = new Date(Date.parse(startTime) + (h + VN_OFFSET_H) * 3600 * 1000);
  return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

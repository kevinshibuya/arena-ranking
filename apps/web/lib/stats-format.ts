// How the site writes a stat, on the page and in link previews alike.

/** 0.4123 → "41%"; null → "–". */
export function percent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

/** 4.236 → "4.2"; null → "–". */
export function placement(average: number | null): string {
  return average === null ? '–' : average.toFixed(1);
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** 1865 → "31:05". */
export function duration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A rating, the ordinal, to one decimal: 23.456 → "23.5"; null → "–". */
export function rating(value: number | null): string {
  return value === null ? '–' : value.toFixed(1);
}

/** An ISO timestamp as a date and time in the region's time zone, e.g. "9 Oct, 22:00 GMT-3". */
export function dateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

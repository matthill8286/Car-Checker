const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2020-02-21` as `21 Feb 2020`. */
export function day(date: string): string {
  const d = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(d.getTime()) ? date : DATE.format(d);
}

/**
 * Turning Planning Center's instants into Ontime's clock times.
 *
 * PCO timestamps are UTC and Ontime works in local time of day, so every time in
 * the connector passes through here. Both conversions go through Intl, so the
 * organisation's timezone is honoured without a date library.
 *
 * A leaf module on purpose: the API client needs the same conversion as the
 * rundown builder, and neither should have to import the other to get it.
 */

function zonedParts(iso: string, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(new Date(iso))) {
    parts[type] = value;
  }
  return parts;
}

/**
 * The calendar date the instant falls on, in the given timezone.
 *
 * This is not the same as slicing the ISO string: a 9am Auckland service arrives
 * as 21:00Z the previous day, so the UTC date is the Saturday.
 */
export function localDateKey(iso: string, timezone: string): string {
  const { year, month, day } = zonedParts(iso, timezone);
  return `${year}-${month}-${day}`;
}

/** milliseconds since local midnight, which is how Ontime holds a clock time */
export function localTimeOfDayMs(iso: string, timezone: string): number {
  const { hour, minute, second } = zonedParts(iso, timezone);
  // Intl renders midnight as "24" in some locales
  const hours = Number(hour) % 24;
  return ((hours * 60 + Number(minute)) * 60 + Number(second)) * 1000;
}

export function localDayLabel(iso: string, timezone: string): string {
  const { weekday, day, month, year } = zonedParts(iso, timezone);
  const monthName = new Intl.DateTimeFormat('en-NZ', { timeZone: timezone, month: 'long' }).format(new Date(iso));
  return `${weekday}, ${Number(day)} ${monthName} ${year} (${year}-${month}-${day})`;
}

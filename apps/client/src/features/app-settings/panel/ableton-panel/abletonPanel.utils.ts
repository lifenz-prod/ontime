/**
 * Formats milliseconds into a clip as m:ss, or h:mm:ss past the hour, rounding down to the second
 * the way a clip ruler reads.
 */
export function formatClipTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * Reads a time into a clip: "3:25", "1:02:03", "3:25.5", or a bare number of seconds.
 * Returns null for anything we cannot read, so the field can keep its last good value.
 */
export function parseClipTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }

  const numbers = parts.map(Number);
  // only the last part may carry a fraction, and only it can be seconds
  if (numbers.slice(0, -1).some((n) => !Number.isInteger(n))) return null;

  const seconds = numbers.reduce((total, part) => total * 60 + part, 0);
  return Math.round(seconds * 1000);
}

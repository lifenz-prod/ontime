import type { TimecodeFrame } from 'ontime-types';

/**
 * A timecode as milliseconds since 00:00:00:00.
 *
 * Drop frame (29.97) timecode is read by its labels at 30 frames: the dropped frame numbers are
 * there to keep those labels on the clock, so this lands within a frame of real time.
 */
export function timecodeToMs(frame: Pick<TimecodeFrame, 'hours' | 'minutes' | 'seconds' | 'frames' | 'fps'>): number {
  const fps = frame.fps > 0 ? frame.fps : 25;
  return ((frame.hours * 60 + frame.minutes) * 60 + frame.seconds) * 1000 + (frame.frames * 1000) / fps;
}

/**
 * Formats milliseconds since 00:00:00:00 as hh:mm:ss:ff at the given frame rate,
 * or hh:mm:ss when the rate is not known.
 */
export function formatTimecode(ms: number, fps: number | null = null): string {
  const totalMs = Math.max(0, ms);
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(Math.floor(totalSeconds / 3600) % 24)}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
  if (!fps) {
    return hms;
  }
  const frames = Math.min(fps - 1, Math.floor(((totalMs % 1000) * fps) / 1000 + 1e-6));
  return `${hms}:${pad(frames)}`;
}

/**
 * Reads hh:mm:ss:ff (or hh:mm:ss, ; for drop frame also accepted) into milliseconds since 00:00:00:00.
 * Frames are counted at `fps`. Returns null for anything it cannot read.
 */
export function parseTimecode(input: string, fps = 25): number | null {
  const parts = input.trim().split(/[:;.]/);
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !/^\d{1,2}$/.test(part))) {
    return null;
  }
  const [hours, minutes, seconds, frames = 0] = parts.map(Number);
  if (hours > 23 || minutes > 59 || seconds > 59 || frames >= fps) {
    return null;
  }
  return timecodeToMs({ hours, minutes, seconds, frames, fps });
}

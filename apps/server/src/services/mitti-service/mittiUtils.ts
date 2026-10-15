import type { MittiState } from 'ontime-types';

/** Mitti sends a bare dash when a field has no value */
export const mittiEmptyValue = '-';

export type MittiCueTimes = {
  cueName: string;
  cueNumber: string;
  trt: number | null; // total run time of the cue, milliseconds
  elapsed: number | null; // milliseconds
  timeLeft: number | null; // milliseconds
  isPlaying: boolean;
};

export function emptyCueTimes(): MittiCueTimes {
  return {
    cueName: '',
    cueNumber: '',
    trt: null,
    elapsed: null,
    timeLeft: null,
    isPlaying: false,
  };
}

/**
 * Whether the cue Mitti is reporting has actually been started.
 *
 * Mitti loads the selected cue into the player and reports its time remaining straight away, so
 * a cue nobody has played yet still arrives with a full countdown on it. QLab only ever lists a
 * cue once it is running or paused, and the views expect that, so we hold a cued-up Mitti cue at
 * zero until it is under way.
 *
 * A cue that is not playing still counts if it has made progress: that is a cue paused part way
 * through, which is exactly what QLab would keep showing.
 */
export function isCueUnderway(cue: MittiCueTimes): boolean {
  if (cue.isPlaying) {
    return true;
  }
  return (cue.elapsed ?? 0) > 0;
}

/**
 * Parses a Mitti timecode string into milliseconds.
 *
 * Mitti sends `HH:MM:SS` or `HH:MM:SS:FF`, and prefixes the remaining time with a minus
 * sign since it counts down. We return the magnitude: the sign carries no information
 * that the field name does not already give us. Frames are dropped — Mitti does not
 * tell us the frame rate, and the countdown is only ever shown to the second.
 *
 * Returns null for anything that is not a timecode, Mitti's `-` placeholder included.
 */
export function parseMittiTimecode(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.trim().match(/^-?(\d{1,3}):([0-5]\d):([0-5]\d)(?::(\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
}

/** Mitti uses a dash for an empty name or cue id */
export function parseMittiLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed === mittiEmptyValue ? '' : trimmed;
}

/**
 * Resolves the three timing fields from whichever of them Mitti has sent us.
 *
 * Mitti pushes each field in its own message, so at any moment we may hold only some
 * of them: we fill the gaps from the others rather than showing a zero.
 */
export function deriveMittiTimes(cue: MittiCueTimes): { duration: number; elapsed: number; remaining: number } {
  const duration = cue.trt ?? (cue.elapsed !== null && cue.timeLeft !== null ? cue.elapsed + cue.timeLeft : 0);

  const remaining = cue.timeLeft ?? (duration > 0 && cue.elapsed !== null ? Math.max(0, duration - cue.elapsed) : 0);

  const elapsed = cue.elapsed ?? (duration > 0 && cue.timeLeft !== null ? Math.max(0, duration - cue.timeLeft) : 0);

  return { duration, elapsed, remaining };
}

/** Mitti pushes feedback several times a second; we only broadcast when something moved */
export function isSameMittiState(a: MittiState, b: MittiState): boolean {
  return (
    a.enabled === b.enabled &&
    a.connected === b.connected &&
    a.cueName === b.cueName &&
    a.cueNumber === b.cueNumber &&
    a.duration === b.duration &&
    a.elapsed === b.elapsed &&
    a.remaining === b.remaining &&
    a.isPaused === b.isPaused &&
    a.phase === b.phase
  );
}

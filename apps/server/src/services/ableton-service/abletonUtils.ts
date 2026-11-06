import { AbletonState, AbletonTimer, TimerPhase } from 'ontime-types';

/** Live's default tempo, used until AbletonOSC has told us the set's own */
export const defaultTempo = 120;

/** how far we carry a position forward on our own clock before we insist on hearing from Live again */
export const maxExtrapolation = 1000;

/** What we last heard about one clip */
export type ClipReading = {
  /** raw playing position from Live: beats for warped clips, seconds for unwarped ones */
  position: number;
  /** our clock when it arrived */
  receivedAt: number;
};

export function clipKey(track: number, clip: number): string {
  return `${track}:${clip}`;
}

/**
 * Converts a clip's playing position to milliseconds into the clip.
 *
 * Live reports a warped clip's position in beats, which only become time through the tempo,
 * and an unwarped audio clip's position in seconds on its own ruler. Until we know which one a
 * clip is, we take it as warped: backing tracks and stems almost always are.
 */
export function clipPositionToMs(position: number, isWarped: boolean | undefined, tempo: number): number {
  if (isWarped === false) {
    return position * 1000;
  }
  const bpm = tempo > 0 ? tempo : defaultTempo;
  return (position * 60000) / bpm;
}

/**
 * Where the playhead is now, carrying the last reading forward while the song plays.
 * We poll Live a few times a second, so between replies we count on our own clock rather
 * than letting the countdown stall. A scrub shows up in the next reading and overrides this.
 */
export function currentPositionMs(
  reading: ClipReading,
  isWarped: boolean | undefined,
  tempo: number,
  isSongPlaying: boolean,
  now: number,
): number {
  const base = clipPositionToMs(reading.position, isWarped, tempo);
  if (!isSongPlaying) {
    return base;
  }
  const carried = Math.min(Math.max(0, now - reading.receivedAt), maxExtrapolation);
  return base + carried;
}

/** Whether this timer's clip is the one playing on its track right now */
export function isTimerClipPlaying(timer: AbletonTimer, playingSlots: ReadonlyMap<number, number>): boolean {
  return playingSlots.get(timer.track) === timer.clip - 1;
}

export type ActiveTimer = {
  timer: AbletonTimer;
  positionMs: number;
  remaining: number;
};

/**
 * Finds the timer that should be on the countdown: the first one in the list whose clip is playing
 * and whose target is still ahead. Once its clip passes the target it lets go, and the countdown
 * goes back to whichever source is selected.
 */
export function findActiveTimer(
  timers: readonly AbletonTimer[],
  playingSlots: ReadonlyMap<number, number>,
  getPositionMs: (timer: AbletonTimer) => number | null,
): ActiveTimer | null {
  for (const timer of timers) {
    if (!isTimerClipPlaying(timer, playingSlots)) continue;
    const positionMs = getPositionMs(timer);
    if (positionMs === null) continue;
    const remaining = timer.target - positionMs;
    if (remaining > 0) {
      return { timer, positionMs, remaining };
    }
  }
  return null;
}

export function getPhase(remaining: number, warningThreshold: number, dangerThreshold: number): TimerPhase {
  if (remaining <= 0) return TimerPhase.Overtime;
  if (remaining <= dangerThreshold) return TimerPhase.Danger;
  if (remaining <= warningThreshold) return TimerPhase.Warning;
  return TimerPhase.Default;
}

/** The countdown views show whole seconds, so we only broadcast when one of those moves */
export function isSameAbletonState(a: AbletonState, b: AbletonState): boolean {
  return (
    a.enabled === b.enabled &&
    a.connected === b.connected &&
    a.cueName === b.cueName &&
    a.cueNumber === b.cueNumber &&
    a.duration === b.duration &&
    Math.floor(a.elapsed / 1000) === Math.floor(b.elapsed / 1000) &&
    Math.ceil(a.remaining / 1000) === Math.ceil(b.remaining / 1000) &&
    a.isPaused === b.isPaused &&
    a.phase === b.phase
  );
}

/** AbletonOSC sends Python booleans as OSC true/false, and some versions as 0/1 */
export function isTruthyArg(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 'True';
}

import { TimecodeFrame, TimecodeReaderStatus, TimecodeState, TimecodeTimer } from 'ontime-types';

/** a reader that has not reported in for this long is taken to be gone */
export const readerTimeout = 3000;

export type ActiveTimecodeTimer = {
  timer: TimecodeTimer;
  remaining: number;
  elapsed: number;
};

/**
 * Finds the timer that should be on the countdown: the first one whose range the timecode is in.
 * A range runs from `from` up to, not including, `zero`; past zero the timer lets go.
 */
export function findActiveTimecodeTimer(timers: readonly TimecodeTimer[], current: number): ActiveTimecodeTimer | null {
  for (const timer of timers) {
    if (timer.zero <= timer.from) continue;
    if (current >= timer.from && current < timer.zero) {
      return { timer, remaining: timer.zero - current, elapsed: current - timer.from };
    }
  }
  return null;
}

/** Whether a reader's frame looks like real timecode rather than a malformed message */
export function isValidFrame(frame: unknown): frame is TimecodeFrame {
  if (!frame || typeof frame !== 'object') return false;
  const { hours, minutes, seconds, frames, fps } = frame as Record<string, unknown>;
  const isInt = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
  return (
    isInt(hours, 23) &&
    isInt(minutes, 59) &&
    isInt(seconds, 59) &&
    isInt(frames, 29) &&
    (fps === 24 || fps === 25 || fps === 30)
  );
}

export function parseReaderStatus(status: unknown): TimecodeReaderStatus | null {
  if (!status || typeof status !== 'object') return null;
  const { devices, deviceLabel, channel, level, error } = status as Record<string, unknown>;
  return {
    devices: Array.isArray(devices) ? devices.filter((d): d is string => typeof d === 'string').slice(0, 64) : [],
    deviceLabel: typeof deviceLabel === 'string' ? deviceLabel : '',
    channel: typeof channel === 'number' ? channel : 1,
    level: typeof level === 'number' && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
    error: typeof error === 'string' ? error.slice(0, 300) : '',
  };
}

/**
 * Frames arrive 25 to 30 times a second, but the views show whole seconds: only broadcast when
 * something they show has moved. The reader's level is rounded for the same reason.
 */
export function isSameTimecodeState(a: TimecodeState, b: TimecodeState): boolean {
  const second = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));
  return (
    a.enabled === b.enabled &&
    a.connected === b.connected &&
    a.signal === b.signal &&
    a.cueName === b.cueName &&
    a.duration === b.duration &&
    Math.ceil(a.remaining / 1000) === Math.ceil(b.remaining / 1000) &&
    a.phase === b.phase &&
    second(a.current) === second(b.current) &&
    a.fps === b.fps &&
    a.dropFrame === b.dropFrame &&
    JSON.stringify(roundReader(a.reader)) === JSON.stringify(roundReader(b.reader))
  );
}

function roundReader(reader: TimecodeState['reader']) {
  if (!reader) return null;
  return { ...reader, level: Math.round(reader.level * 20) / 20 };
}

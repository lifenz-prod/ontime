import type { CountdownSourceState } from './Countdown.type.js';

/**
 * A countdown on incoming timecode (LTC).
 * While the timecode is between `from` and `zero`, it takes over the playback countdown and counts down to `zero`.
 */
export type TimecodeTimer = {
  id: string;
  name: string;
  from: number; // timecode, as milliseconds since 00:00:00:00, where the timer starts
  zero: number; // timecode, as milliseconds since 00:00:00:00, where the countdown reaches zero
};

export type TimecodeSettings = {
  enabled: boolean;
  /** the sound card the reader records from, by name as the system shows it. Empty for the default input */
  deviceLabel: string;
  /** the input channel carrying the timecode, 1-based */
  channel: number;
  warningThreshold: number; // milliseconds, default 30000
  dangerThreshold: number; // milliseconds, default 10000
  /** milliseconds without a timecode frame before we count the signal as gone, default 500 */
  timeout: number;
  timers: TimecodeTimer[];
};

/** One decoded timecode frame, as a reader sends it to the server */
export type TimecodeFrame = {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame: boolean;
  fps: number; // 24, 25 or 30 (30 for 29.97 drop frame)
};

/** What a timecode reader tells the server about itself, about once a second */
export type TimecodeReaderStatus = {
  /** the inputs the reader can see, by name */
  devices: string[];
  /** the input it is recording from, empty if none */
  deviceLabel: string;
  channel: number;
  /** peak level on the timecode channel over the last second, 0 to 1 */
  level: number;
  /** why it is not reading, if it is not */
  error: string;
};

export type TimecodeState = CountdownSourceState & {
  /** whether timecode frames are arriving */
  signal: boolean;
  /** the latest timecode, as milliseconds since 00:00:00:00 */
  current: number | null;
  fps: number | null;
  dropFrame: boolean;
  /** the reader that last reported in, if any is running */
  reader: (TimecodeReaderStatus & { connected: boolean }) | null;
};

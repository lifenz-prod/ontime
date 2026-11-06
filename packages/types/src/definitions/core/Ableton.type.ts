import type { CountdownSourceState } from './Countdown.type.js';

export type AbletonState = CountdownSourceState;

/**
 * A countdown to a point in a Session View clip.
 * While that clip plays and the point is still ahead, it takes over the playback countdown.
 */
export type AbletonTimer = {
  id: string;
  name: string;
  track: number; // 1-based, as Live shows them left to right
  clip: number; // 1-based clip slot (scene row) on that track
  target: number; // milliseconds into the clip, on the clip's own time ruler, where the countdown reaches zero
};

export type AbletonSettings = {
  enabled: boolean;
  host: string; // the Mac running Ableton Live with AbletonOSC
  port: number; // AbletonOSC's input port, default 11000
  listenPort: number; // where AbletonOSC replies, default 11001 (AbletonOSC always replies to 11001)
  warningThreshold: number; // milliseconds, default 30000
  dangerThreshold: number; // milliseconds, default 10000
  timeout: number; // milliseconds without a reply before we call it disconnected, default 5000
  timers: AbletonTimer[];
};

/** What "Set to current position" reads back from Live for one clip */
export type AbletonClipPosition = {
  position: number; // milliseconds into the clip
  isPlaying: boolean; // whether that clip is the one playing on its track
  trackName: string;
  clipName: string;
};

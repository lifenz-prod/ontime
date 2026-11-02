import type { CountdownSourceState } from './Countdown.type.js';

export type MittiState = CountdownSourceState;

export type MittiSettings = {
  enabled: boolean;
  host: string;
  port: number; // Mitti's OSC input port, default 51000
  listenPort: number; // port Mitti sends its feedback to, default 51001
  warningThreshold: number; // milliseconds, default 30000
  dangerThreshold: number; // milliseconds, default 10000
  timeout: number; // milliseconds without feedback before we call it disconnected, default 5000
  // Mitti feeds one destination only, so Ontime passes what it receives on to a second listener
  // (in practice Companion, which needs the feedback to drive its buttons). null disables it.
  relayHost: string | null;
  relayPort: number | null;
};

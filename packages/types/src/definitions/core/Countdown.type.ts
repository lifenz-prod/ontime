import type { TimerPhase } from '../runtime/TimerState.type.js';

/** Which playback system feeds the countdown views */
export type CountdownSource = 'qlab' | 'mitti';

/**
 * Everything that can be on the countdown: the selected source, or Ableton or timecode, which take
 * over by themselves while one of their timers is running and hand back when it is done
 */
export type CountdownProvider = CountdownSource | 'ableton' | 'timecode';

/**
 * The shape every countdown provider resolves to.
 * QlabState and MittiState both conform to it so the views can stay source agnostic.
 */
export type CountdownSourceState = {
  enabled: boolean;
  connected: boolean;
  cueName: string;
  cueNumber: string;
  duration: number; // milliseconds
  elapsed: number; // milliseconds
  remaining: number; // milliseconds
  isPaused: boolean;
  phase: TimerPhase;
};

/** The countdown the views read: the selected source's state, tagged with which source it came from */
export type CountdownState = CountdownSourceState & {
  source: CountdownProvider;
};

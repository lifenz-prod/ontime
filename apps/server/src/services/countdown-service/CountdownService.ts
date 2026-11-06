import {
  abletonStatePlaceholder,
  CountdownProvider,
  CountdownSource,
  CountdownSourceState,
  CountdownState,
  mittiStatePlaceholder,
  qlabStatePlaceholder,
  timecodeStatePlaceholder,
} from 'ontime-types';

import { eventStore } from '../../stores/EventStore.js';

/**
 * Holds the state of every countdown provider and publishes the one on screen.
 *
 * The integrations push into here rather than the other way around: it keeps this
 * service free of imports back into QlabService / MittiService, and means the views
 * only ever read a single resolved key.
 *
 * QLab and Mitti are chosen in view settings. Ableton and timecode are not chosen: each takes
 * over by itself while one of its timers is running (its duration is only ever non-zero then),
 * Ableton first if both are, and the selected source comes back as soon as they let go.
 */
class CountdownService {
  private source: CountdownSource = 'qlab';
  private states: Record<CountdownProvider, CountdownSourceState> = {
    qlab: { ...qlabStatePlaceholder },
    mitti: { ...mittiStatePlaceholder },
    ableton: { ...abletonStatePlaceholder },
    timecode: { ...timecodeStatePlaceholder },
  };
  private lastProvider: CountdownProvider = 'qlab';

  /** Selects which integration feeds the countdown views */
  setSource(source: CountdownSource) {
    this.source = source;
    this.broadcastState();
  }

  getSource(): CountdownSource {
    return this.source;
  }

  /** Called by an integration whenever its own state changes */
  update(provider: CountdownProvider, state: CountdownSourceState) {
    this.states[provider] = state;
    const onScreen = this.getProvider();
    // a change to what is on screen, or a hand over between providers
    if (provider === onScreen || onScreen !== this.lastProvider) {
      this.broadcastState();
    }
  }

  /** Which provider the views should be showing right now */
  getProvider(): CountdownProvider {
    if (isTimerRunning(this.states.ableton)) {
      return 'ableton';
    }
    if (isTimerRunning(this.states.timecode)) {
      return 'timecode';
    }
    return this.source;
  }

  getState(): CountdownState {
    const provider = this.getProvider();
    const { enabled, connected, cueName, cueNumber, duration, elapsed, remaining, isPaused, phase } =
      this.states[provider];
    // only the shared fields: timecode carries more, which the countdown views have no use for
    return { source: provider, enabled, connected, cueName, cueNumber, duration, elapsed, remaining, isPaused, phase };
  }

  private broadcastState() {
    const state = this.getState();
    this.lastProvider = state.source;
    eventStore.set('countdown', state);
  }
}

function isTimerRunning(state: CountdownSourceState): boolean {
  return state.enabled && state.connected && state.duration > 0 && state.remaining > 0;
}

export const countdownService = new CountdownService();

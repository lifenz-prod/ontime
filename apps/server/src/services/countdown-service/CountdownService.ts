import {
  abletonStatePlaceholder,
  CountdownProvider,
  CountdownSource,
  CountdownSourceState,
  CountdownState,
  mittiStatePlaceholder,
  qlabStatePlaceholder,
} from 'ontime-types';

import { eventStore } from '../../stores/EventStore.js';

/**
 * Holds the state of every countdown provider and publishes the one on screen.
 *
 * The integrations push into here rather than the other way around: it keeps this
 * service free of imports back into QlabService / MittiService, and means the views
 * only ever read a single resolved key.
 *
 * QLab and Mitti are chosen in view settings. Ableton is not chosen: it takes over by itself
 * while one of its timers is running (its duration is only ever non-zero then), and the
 * selected source comes back as soon as it lets go.
 */
class CountdownService {
  private source: CountdownSource = 'qlab';
  private states: Record<CountdownProvider, CountdownSourceState> = {
    qlab: { ...qlabStatePlaceholder },
    mitti: { ...mittiStatePlaceholder },
    ableton: { ...abletonStatePlaceholder },
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
    if (isAbletonRunning(this.states.ableton)) {
      return 'ableton';
    }
    return this.source;
  }

  getState(): CountdownState {
    const provider = this.getProvider();
    return { source: provider, ...this.states[provider] };
  }

  private broadcastState() {
    const state = this.getState();
    this.lastProvider = state.source;
    eventStore.set('countdown', state);
  }
}

function isAbletonRunning(state: CountdownSourceState): boolean {
  return state.enabled && state.connected && state.duration > 0 && state.remaining > 0;
}

export const countdownService = new CountdownService();

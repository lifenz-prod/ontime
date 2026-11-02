import {
  CountdownSource,
  CountdownSourceState,
  CountdownState,
  mittiStatePlaceholder,
  qlabStatePlaceholder,
} from 'ontime-types';

import { eventStore } from '../../stores/EventStore.js';

/**
 * Holds the state of every countdown provider and publishes the selected one.
 *
 * The integrations push into here rather than the other way around: it keeps this
 * service free of imports back into QlabService / MittiService, and means the views
 * only ever read a single resolved key.
 */
class CountdownService {
  private source: CountdownSource = 'qlab';
  private states: Record<CountdownSource, CountdownSourceState> = {
    qlab: { ...qlabStatePlaceholder },
    mitti: { ...mittiStatePlaceholder },
  };

  /** Selects which integration feeds the countdown views */
  setSource(source: CountdownSource) {
    this.source = source;
    this.broadcastState();
  }

  getSource(): CountdownSource {
    return this.source;
  }

  /** Called by an integration whenever its own state changes */
  update(source: CountdownSource, state: CountdownSourceState) {
    this.states[source] = state;
    if (source === this.source) {
      this.broadcastState();
    }
  }

  getState(): CountdownState {
    return { source: this.source, ...this.states[this.source] };
  }

  private broadcastState() {
    eventStore.set('countdown', this.getState());
  }
}

export const countdownService = new CountdownService();

import { millisToSeconds } from 'ontime-utils';

import { timerConfig } from '../../config/config.js';
import { EndAction, MaybeNumber, Playback } from 'ontime-types';

import type { RuntimeState } from '../../stores/runtimeState.js';

/**
 * Checks whether we should update the clock value
 * - clock has slid
 * - we have rolled into a new seconds unit
 */
export function getShouldClockUpdate(previousUpdate: number, now: number): boolean {
  const shouldForceUpdate = getForceUpdate(previousUpdate, now);
  if (shouldForceUpdate) {
    return true;
  }
  const isClockSecondAhead = millisToSeconds(now) !== millisToSeconds(previousUpdate + timerConfig.triggerAhead);
  return isClockSecondAhead;
}

/**
 * Checks whether we should update the timer value
 * - we have rolled into a new seconds unit
 */
export function getShouldTimerUpdate(previousValue: MaybeNumber, currentValue: MaybeNumber): boolean {
  if (currentValue === null) {
    return false;
  }
  // we avoid trigger ahead since it can cause duplicate triggers
  const shouldUpdateTimer = millisToSeconds(currentValue) !== millisToSeconds(previousValue);
  return shouldUpdateTimer;
}

/**
 * In some cases we want to force an update to the timer
 * - if the clock has slid back
 * - if we have escaped the update rate (clock slid forward)
 * - if we are not playing then there is no need to update the timer
 */
export function getForceUpdate(previousUpdate: number, now: number): boolean {
  const isClockBehind = now < previousUpdate;
  const hasExceededRate = now - previousUpdate >= timerConfig.notificationRate;
  const newSeconds = millisToSeconds(previousUpdate) !== millisToSeconds(now);
  return isClockBehind || hasExceededRate || newSeconds;
}

/**
 * Resolution of a pending EndAction.PlayNextDelayed
 * - none: nothing to do
 * - cancel: the operator has taken over during the overrun, we should not advance
 * - advance: the event has overrun for long enough, we should start the next event
 */
export type DelayedAdvance = 'none' | 'cancel' | 'advance';

/**
 * Decides what to do with an event using EndAction.PlayNextDelayed.
 * The event is allowed to overrun by the given delay before we advance,
 * so that the rollover into the next event is visible in the views.
 *
 * @param state - current runtime state
 * @param delay - how long the event may overrun, in milliseconds
 * @param resolvedFor - id of the event whose advance we have already resolved, if any
 */
export function getDelayedAdvance(
  state: Pick<RuntimeState, 'eventNow' | 'timer'>,
  delay: number,
  resolvedFor: string | null,
): DelayedAdvance {
  const eventNow = state.eventNow;
  if (!eventNow || eventNow.endAction !== EndAction.PlayNextDelayed) {
    return 'none';
  }

  // current is negative once the event is in overtime
  const overrun = state.timer.current === null ? 0 : -state.timer.current;

  // pausing during the overrun means the operator is taking over
  // pausing before the event has finished has no bearing on the end action
  if (state.timer.playback === Playback.Pause) {
    return overrun > 0 && resolvedFor !== eventNow.id ? 'cancel' : 'none';
  }

  if (state.timer.playback !== Playback.Play || resolvedFor === eventNow.id) {
    return 'none';
  }

  return overrun >= delay ? 'advance' : 'none';
}

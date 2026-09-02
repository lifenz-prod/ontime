import { EndAction, TimerType } from 'ontime-types';
import { expect } from 'vitest';

import { validateEndAction, validateEndActionDelay, validateTimerType } from './validateEvent.js';

describe('validateEndAction()', () => {
  it('recognises a string representation of an action', () => {
    const endAction = validateEndAction('load-next');
    expect(endAction).toBe(EndAction.LoadNext);
  });
  it('recognises the delayed advance action, this is the keyword used in the sheet import', () => {
    const endAction = validateEndAction('play-next-delayed');
    expect(endAction).toBe(EndAction.PlayNextDelayed);
  });
  it('returns fallback otherwise', () => {
    const emptyAction = validateEndAction('', EndAction.Stop);
    const invalidAction = validateEndAction('this-does-not-exist', EndAction.PlayNext);
    expect(emptyAction).toBe(EndAction.Stop);
    expect(invalidAction).toBe(EndAction.PlayNext);
  });
});

describe('validateEndActionDelay()', () => {
  it('accepts a delay in seconds', () => {
    expect(validateEndActionDelay(15)).toBe(15);
    expect(validateEndActionDelay('45')).toBe(45);
    expect(validateEndActionDelay(0)).toBe(0);
  });
  it('rounds fractional values', () => {
    expect(validateEndActionDelay(30.4)).toBe(30);
    expect(validateEndActionDelay(30.6)).toBe(31);
  });
  it('clamps out of range values', () => {
    expect(validateEndActionDelay(-10)).toBe(0);
    expect(validateEndActionDelay(999999)).toBe(3600);
  });
  it('returns fallback for values which are not numbers', () => {
    expect(validateEndActionDelay(undefined)).toBe(30);
    expect(validateEndActionDelay(null, 10)).toBe(10);
    expect(validateEndActionDelay('this-does-not-exist', 10)).toBe(10);
  });
});

describe('validateTimerType()', () => {
  it('recognises a string representation of an action', () => {
    const timerType = validateTimerType('count-up');
    expect(timerType).toBe(TimerType.CountUp);
  });
  it('returns fallback otherwise', () => {
    const emptyType = validateTimerType('', TimerType.Clock);
    const invalidType = validateTimerType('this-does-not-exist', TimerType.CountDown);
    expect(emptyType).toBe(TimerType.Clock);
    expect(invalidType).toBe(TimerType.CountDown);
  });
  it('handles a null value from params', () => {
    const nullType = validateTimerType(null, TimerType.Clock);
    expect(nullType).toBe(TimerType.Clock);
  });
});

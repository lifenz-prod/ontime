import { AbletonTimer, TimerPhase } from 'ontime-types';

import {
  clipPositionToMs,
  currentPositionMs,
  findActiveTimer,
  getPhase,
  isTruthyArg,
  maxExtrapolation,
} from '../abletonUtils.js';

const timer = (overrides: Partial<AbletonTimer> = {}): AbletonTimer => ({
  id: 'a',
  name: 'Song',
  track: 1,
  clip: 2,
  target: 60000,
  ...overrides,
});

describe('clipPositionToMs()', () => {
  it('reads a warped clip in beats, through the tempo', () => {
    // 8 beats at 120 bpm is 4 seconds
    expect(clipPositionToMs(8, true, 120)).toBe(4000);
    expect(clipPositionToMs(8, true, 60)).toBe(8000);
  });

  it('reads an unwarped clip in seconds', () => {
    expect(clipPositionToMs(12.5, false, 120)).toBe(12500);
  });

  it('takes a clip as warped until we know otherwise', () => {
    expect(clipPositionToMs(8, undefined, 120)).toBe(4000);
  });

  it('falls back to the default tempo rather than dividing by zero', () => {
    expect(clipPositionToMs(8, true, 0)).toBe(4000);
  });
});

describe('currentPositionMs()', () => {
  const reading = { position: 2, receivedAt: 10000 }; // 2 beats = 1s at 120

  it('carries the reading forward on our clock while the song plays', () => {
    expect(currentPositionMs(reading, true, 120, true, 10250)).toBe(1250);
  });

  it('holds still while the song is stopped', () => {
    expect(currentPositionMs(reading, true, 120, false, 10250)).toBe(1000);
  });

  it('does not run away if Live goes quiet', () => {
    expect(currentPositionMs(reading, true, 120, true, 60000)).toBe(1000 + maxExtrapolation);
  });
});

describe('findActiveTimer()', () => {
  it('picks the timer whose clip is playing', () => {
    const timers = [timer({ id: 'a', clip: 1 }), timer({ id: 'b', clip: 2 })];
    const result = findActiveTimer(timers, new Map([[1, 1]]), () => 15000);
    expect(result?.timer.id).toBe('b');
    expect(result?.remaining).toBe(45000);
  });

  it('lets go once the clip passes the target', () => {
    const result = findActiveTimer([timer()], new Map([[1, 1]]), () => 60000);
    expect(result).toBeNull();
  });

  it('ignores a clip we have no position for yet', () => {
    const result = findActiveTimer([timer()], new Map([[1, 1]]), () => null);
    expect(result).toBeNull();
  });

  it('ignores a track that is playing a different clip, or none', () => {
    expect(findActiveTimer([timer()], new Map([[1, 0]]), () => 0)).toBeNull();
    expect(findActiveTimer([timer()], new Map([[1, -1]]), () => 0)).toBeNull();
    expect(findActiveTimer([timer()], new Map(), () => 0)).toBeNull();
  });

  it('moves on to the next timer on the same clip once the first one is passed', () => {
    const timers = [timer({ id: 'intro', target: 10000 }), timer({ id: 'outro', target: 60000 })];
    const result = findActiveTimer(timers, new Map([[1, 1]]), () => 20000);
    expect(result?.timer.id).toBe('outro');
  });
});

describe('getPhase()', () => {
  it('follows the thresholds', () => {
    expect(getPhase(60000, 30000, 10000)).toBe(TimerPhase.Default);
    expect(getPhase(20000, 30000, 10000)).toBe(TimerPhase.Warning);
    expect(getPhase(5000, 30000, 10000)).toBe(TimerPhase.Danger);
    expect(getPhase(0, 30000, 10000)).toBe(TimerPhase.Overtime);
  });
});

describe('isTruthyArg()', () => {
  it('reads the shapes AbletonOSC sends for a boolean', () => {
    expect(isTruthyArg(true)).toBe(true);
    expect(isTruthyArg(1)).toBe(true);
    expect(isTruthyArg(false)).toBe(false);
    expect(isTruthyArg(0)).toBe(false);
  });
});

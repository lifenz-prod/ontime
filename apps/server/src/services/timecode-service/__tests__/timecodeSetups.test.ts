import type { TimecodeSetup } from 'ontime-types';

import { parseTimecodeSetups, removeTimecodeSetup, upsertTimecodeSetup } from '../timecodeSetups.js';

const walkIn = { id: 't1', name: 'Walk in', from: 3_600_000, zero: 3_900_000 };
const opener = { id: 't2', name: 'Opener', from: 3_900_000, zero: 4_200_000 };

describe('parseTimecodeSetups()', () => {
  it('keeps valid setups and drops malformed ones', () => {
    const result = parseTimecodeSetups([
      { id: 'a', name: ' Sunday AM ', timers: [walkIn], savedAt: 5 },
      { id: 'b', name: '', timers: [] },
      'not a setup',
      { name: 'No id', timers: [{ from: 10, zero: 5 }] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'a', name: 'Sunday AM', timers: [walkIn], savedAt: 5 });
    // a timer that runs backwards is dropped, and a missing id is filled in
    expect(result[1].timers).toEqual([]);
    expect(result[1].id).not.toBe('');
  });

  it('reads anything that is not a list as an empty library', () => {
    expect(parseTimecodeSetups({ setups: [] })).toEqual([]);
    expect(parseTimecodeSetups(null)).toEqual([]);
  });
});

describe('upsertTimecodeSetup()', () => {
  it('adds a new setup', () => {
    const { setups, saved } = upsertTimecodeSetup([], 'Sunday AM', [walkIn], 100);
    expect(setups).toEqual([saved]);
    expect(saved).toMatchObject({ name: 'Sunday AM', timers: [walkIn], savedAt: 100 });
  });

  it('replaces a setup with the same name, ignoring case, and keeps its id', () => {
    const existing: TimecodeSetup = { id: 'keep', name: 'Sunday AM', timers: [walkIn], savedAt: 1 };
    const { setups, saved } = upsertTimecodeSetup([existing], 'sunday am', [opener], 200);
    expect(setups).toHaveLength(1);
    expect(saved).toEqual({ id: 'keep', name: 'sunday am', timers: [opener], savedAt: 200 });
  });

  it('lists setups alphabetically', () => {
    const first = upsertTimecodeSetup([], 'Sunday PM', [], 1).setups;
    const { setups } = upsertTimecodeSetup(first, 'christmas', [], 2);
    expect(setups.map((setup) => setup.name)).toEqual(['christmas', 'Sunday PM']);
  });

  it('refuses an empty name', () => {
    expect(() => upsertTimecodeSetup([], '   ', [walkIn])).toThrow();
  });
});

describe('removeTimecodeSetup()', () => {
  it('removes by id', () => {
    const setups: TimecodeSetup[] = [
      { id: 'a', name: 'A', timers: [], savedAt: 0 },
      { id: 'b', name: 'B', timers: [], savedAt: 0 },
    ];
    expect(removeTimecodeSetup(setups, 'a').map((setup) => setup.id)).toEqual(['b']);
  });
});

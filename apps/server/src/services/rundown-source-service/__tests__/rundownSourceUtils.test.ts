import { Playback, type RundownSource } from 'ontime-types';

import { parseSourceTarget, playbackBlocksRecall, resolveSourceTarget } from '../rundownSourceUtils.js';

describe('parseSourceTarget()', () => {
  it('reads a numeric index', () => {
    expect(parseSourceTarget(1)).toBe(1);
    expect(parseSourceTarget(12)).toBe(12);
  });

  it('reads an index sent as text, as OSC and HTTP often do', () => {
    expect(parseSourceTarget('3')).toBe(3);
    expect(parseSourceTarget(' 3 ')).toBe(3);
  });

  it('reads a name', () => {
    expect(parseSourceTarget('Rehearsal')).toBe('Rehearsal');
    expect(parseSourceTarget('  Sunday 9am  ')).toBe('Sunday 9am');
  });

  it('reads an object with an index or a name', () => {
    expect(parseSourceTarget({ index: 2 })).toBe(2);
    expect(parseSourceTarget({ index: '2' })).toBe(2);
    expect(parseSourceTarget({ name: 'Rehearsal' })).toBe('Rehearsal');
  });

  it('rejects an index which cannot address a source', () => {
    expect(() => parseSourceTarget(0)).toThrow();
    expect(() => parseSourceTarget(-1)).toThrow();
    expect(() => parseSourceTarget(1.5)).toThrow();
  });

  it('rejects payloads which are neither an index nor a name', () => {
    expect(() => parseSourceTarget(undefined)).toThrow();
    expect(() => parseSourceTarget(null)).toThrow();
    expect(() => parseSourceTarget('')).toThrow();
    expect(() => parseSourceTarget('   ')).toThrow();
    expect(() => parseSourceTarget({ nonsense: 1 })).toThrow();
    expect(() => parseSourceTarget(true)).toThrow();
  });
});

describe('resolveSourceTarget()', () => {
  const sources: RundownSource[] = [
    { index: 1, name: 'Sunday 9am + 11am' },
    { index: 2, name: 'Rehearsal' },
    { index: 3, name: 'Christmas Eve' },
  ];

  it('finds a source by its 1 based index', () => {
    expect(resolveSourceTarget(sources, 1)).toEqual({ index: 1, name: 'Sunday 9am + 11am' });
    expect(resolveSourceTarget(sources, 3)).toEqual({ index: 3, name: 'Christmas Eve' });
  });

  it('finds a source by name, ignoring case and padding', () => {
    expect(resolveSourceTarget(sources, 'rehearsal')).toEqual({ index: 2, name: 'Rehearsal' });
    expect(resolveSourceTarget(sources, '  CHRISTMAS EVE ')).toEqual({ index: 3, name: 'Christmas Eve' });
  });

  it('returns undefined when there is no match', () => {
    expect(resolveSourceTarget(sources, 4)).toBeUndefined();
    expect(resolveSourceTarget(sources, 'Good Friday')).toBeUndefined();
    expect(resolveSourceTarget([], 1)).toBeUndefined();
  });
});

describe('playbackBlocksRecall()', () => {
  it('refuses a recall which would interrupt a live show', () => {
    expect(playbackBlocksRecall(Playback.Play)).toBe(true);
    expect(playbackBlocksRecall(Playback.Pause)).toBe(true);
    expect(playbackBlocksRecall(Playback.Roll)).toBe(true);
  });

  it('allows a recall when nothing is running', () => {
    expect(playbackBlocksRecall(Playback.Stop)).toBe(false);
  });

  it('allows a recall when an event is only armed, so two recalls in a row work', () => {
    // a recall itself leaves playback armed
    expect(playbackBlocksRecall(Playback.Armed)).toBe(false);
  });
});

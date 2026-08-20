import { Playback, type RundownSource, type RundownSourceProvider } from 'ontime-types';
import { describe, expect, it } from 'vitest';

import { parseSourceTarget, playbackBlocksRecall, resolveSourceTarget } from '../rundownSourceUtils.js';

describe('parseSourceTarget', () => {
  it('reads a bare index', () => {
    expect(parseSourceTarget(3)).toEqual({ provider: undefined, target: 3 });
  });

  it('reads a bare name', () => {
    expect(parseSourceTarget('Rehearsal')).toEqual({ provider: undefined, target: 'Rehearsal' });
  });

  it('treats a number sent as text as an index, which OSC and HTTP both do', () => {
    expect(parseSourceTarget('3')).toEqual({ provider: undefined, target: 3 });
  });

  it('reads the object forms', () => {
    expect(parseSourceTarget({ index: 2 })).toEqual({ provider: undefined, target: 2 });
    expect(parseSourceTarget({ name: 'Rehearsal' })).toEqual({ provider: undefined, target: 'Rehearsal' });
  });

  it('reads an explicit provider', () => {
    expect(parseSourceTarget({ provider: 'pco', name: 'Central AM' })).toEqual({
      provider: 'pco',
      target: 'Central AM',
    });
    expect(parseSourceTarget({ provider: 'gsheet', index: 2 })).toEqual({ provider: 'gsheet', target: 2 });
  });

  it('reads a provider prefix, which is all a single OSC argument can carry', () => {
    expect(parseSourceTarget('pco:Central AM')).toEqual({ provider: 'pco', target: 'Central AM' });
    expect(parseSourceTarget('gsheet:2')).toEqual({ provider: 'gsheet', target: 2 });
  });

  it('reads the provider-keyed object the adapters build from a path', () => {
    // /ontime/loadsource/pco 1 and GET /api/loadsource/pco/1 both arrive like this
    expect(parseSourceTarget({ pco: 1 })).toEqual({ provider: 'pco', target: 1 });
    expect(parseSourceTarget({ gsheet: 'Rehearsal' })).toEqual({ provider: 'gsheet', target: 'Rehearsal' });
  });

  it('leaves a name that merely contains a colon alone', () => {
    expect(parseSourceTarget('Sunday: Christmas Eve')).toEqual({
      provider: undefined,
      target: 'Sunday: Christmas Eve',
    });
  });

  it('ignores an unknown provider prefix rather than eating the name', () => {
    expect(parseSourceTarget('excel:Sheet1')).toEqual({ provider: undefined, target: 'excel:Sheet1' });
  });

  it('rejects what cannot be read as either', () => {
    expect(() => parseSourceTarget(null)).toThrowError(/not a valid source/);
    expect(() => parseSourceTarget('')).toThrowError(/not a valid source/);
    expect(() => parseSourceTarget({ nonsense: 1, andMore: 2 })).toThrowError(/not a valid source/);
    expect(() => parseSourceTarget(0)).toThrowError(/out of range/);
    expect(() => parseSourceTarget(-1)).toThrowError(/out of range/);
    expect(() => parseSourceTarget(1.5)).toThrowError(/out of range/);
  });
});

describe('resolveSourceTarget', () => {
  /** a sheet with two tabs and Planning Center with two pinned service types */
  const source = (
    index: number,
    providerIndex: number,
    name: string,
    provider: RundownSourceProvider,
  ): RundownSource => ({ index, providerIndex, name, provider });

  const sources: RundownSource[] = [
    source(1, 1, 'Sunday 9am + 11am', 'gsheet'),
    source(2, 2, 'Rehearsal', 'gsheet'),
    source(3, 1, 'Central AM', 'pco'),
    source(4, 2, 'Central PM', 'pco'),
  ];

  it('finds by position in the whole list', () => {
    expect(resolveSourceTarget(sources, { target: 3 })?.name).toBe('Central AM');
  });

  it('counts a scoped index within that provider', () => {
    // the address that does not move when the sheet gains a tab
    expect(resolveSourceTarget(sources, { provider: 'pco', target: 1 })?.name).toBe('Central AM');
    expect(resolveSourceTarget(sources, { provider: 'pco', target: 2 })?.name).toBe('Central PM');
    expect(resolveSourceTarget(sources, { provider: 'gsheet', target: 1 })?.name).toBe('Sunday 9am + 11am');
  });

  it('finds by name, case insensitively', () => {
    expect(resolveSourceTarget(sources, { target: 'central am' })?.provider).toBe('pco');
    expect(resolveSourceTarget(sources, { target: ' Rehearsal ' })?.provider).toBe('gsheet');
  });

  it('will not silently pick one when a name exists in both providers', () => {
    // replacing the rundown from the wrong origin is worse than refusing
    const ambiguous = [...sources, source(5, 3, 'Rehearsal', 'pco')];
    expect(() => resolveSourceTarget(ambiguous, { target: 'Rehearsal' })).toThrowError(/exists in gsheet and pco/);
  });

  it('resolves that same name once a provider is named', () => {
    const ambiguous = [...sources, source(5, 3, 'Rehearsal', 'pco')];
    expect(resolveSourceTarget(ambiguous, { provider: 'pco', target: 'Rehearsal' })?.providerIndex).toBe(3);
  });

  it('returns nothing for an address it does not hold', () => {
    expect(resolveSourceTarget(sources, { target: 9 })).toBeUndefined();
    expect(resolveSourceTarget(sources, { target: 'Christmas Eve' })).toBeUndefined();
    expect(resolveSourceTarget(sources, { provider: 'gsheet', target: 'Central AM' })).toBeUndefined();
  });
});

describe('playbackBlocksRecall', () => {
  it('refuses to replace the rundown under a running show', () => {
    expect(playbackBlocksRecall(Playback.Play)).toBe(true);
    expect(playbackBlocksRecall(Playback.Pause)).toBe(true);
    expect(playbackBlocksRecall(Playback.Roll)).toBe(true);
  });

  it('allows it when nothing is running', () => {
    // armed is deliberately allowed: a recall interrupts no one and arms nothing
    expect(playbackBlocksRecall(Playback.Armed)).toBe(false);
    expect(playbackBlocksRecall(Playback.Stop)).toBe(false);
  });
});

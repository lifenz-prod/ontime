import { parseMittiRelays } from '../mitti.parser.js';

describe('parseMittiRelays()', () => {
  it('keeps every valid relay', () => {
    expect(
      parseMittiRelays({
        relays: [
          { host: '10.0.0.5', port: 51002 },
          { host: ' 10.0.0.6 ', port: 51003 },
        ],
      }),
    ).toEqual([
      { host: '10.0.0.5', port: 51002 },
      { host: '10.0.0.6', port: 51003 },
    ]);
  });

  it('drops entries without a host or a usable port, and duplicates', () => {
    expect(
      parseMittiRelays({
        relays: [
          { host: '', port: 51002 },
          { host: '10.0.0.5', port: 0 },
          { host: '10.0.0.5', port: 70000 },
          { host: '10.0.0.5' },
          null,
          'nope',
          { host: '10.0.0.5', port: 51002 },
          { host: '10.0.0.5', port: 51002 },
        ],
      }),
    ).toEqual([{ host: '10.0.0.5', port: 51002 }]);
  });

  it('carries over the single relay of projects saved before relays became a list', () => {
    expect(parseMittiRelays({ relayHost: '10.0.0.5', relayPort: 51002 })).toEqual([{ host: '10.0.0.5', port: 51002 }]);
    expect(parseMittiRelays({ relayHost: null, relayPort: null })).toEqual([]);
  });

  it('returns no relays for missing data', () => {
    expect(parseMittiRelays(undefined)).toEqual([]);
    expect(parseMittiRelays({})).toEqual([]);
  });
});

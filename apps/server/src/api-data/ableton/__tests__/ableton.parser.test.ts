import { parseAbletonSettings, parseAbletonTimers } from '../ableton.parser.js';

describe('parseAbletonTimers()', () => {
  it('keeps timers that point at a track and clip and have a target', () => {
    expect(parseAbletonTimers([{ id: 'a', name: ' Way Maker ', track: 1, clip: 2, target: 205000.4 }])).toEqual([
      { id: 'a', name: 'Way Maker', track: 1, clip: 2, target: 205000 },
    ]);
  });

  it('drops rows it cannot use', () => {
    expect(
      parseAbletonTimers([
        { track: 0, clip: 1, target: 1000 },
        { track: 1, clip: 1.5, target: 1000 },
        { track: 1, clip: 1, target: 0 },
        { track: 1, clip: 1 },
        null,
        'nope',
      ]),
    ).toEqual([]);
  });

  it('gives a timer without an id one of its own', () => {
    const [timer] = parseAbletonTimers([{ track: 1, clip: 1, target: 1000 }]);
    expect(typeof timer.id).toBe('string');
    expect(timer.id).not.toBe('');
    expect(timer.name).toBe('');
  });
});

describe('parseAbletonSettings()', () => {
  it('fills in defaults for a project saved before Ableton existed', () => {
    expect(parseAbletonSettings({})).toMatchObject({
      enabled: false,
      host: '127.0.0.1',
      port: 11000,
      listenPort: 11001,
      timers: [],
    });
  });

  it('keeps what was saved', () => {
    const parsed = parseAbletonSettings({
      ableton: {
        enabled: true,
        host: '10.0.0.20',
        port: 11000,
        listenPort: 11001,
        warningThreshold: 20000,
        dangerThreshold: 5000,
        timeout: 4000,
        timers: [{ id: 'a', name: 'Outro', track: 3, clip: 4, target: 60000 }],
      },
    });
    expect(parsed).toMatchObject({ enabled: true, host: '10.0.0.20', warningThreshold: 20000, timers: [{ id: 'a' }] });
  });
});

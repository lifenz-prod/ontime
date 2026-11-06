import type { TimecodeSettings, TimecodeState } from 'ontime-types';

import { findActiveTimecodeTimer, isValidFrame } from '../timecodeUtils.js';

vi.mock('../../../classes/Logger.js', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../stores/EventStore.js', () => ({
  eventStore: { set: vi.fn() },
}));
vi.mock('../../countdown-service/CountdownService.js', () => ({
  countdownService: { update: vi.fn() },
}));

const tc = (h: number, m: number, s: number, f = 0) => ((h * 60 + m) * 60 + s) * 1000 + f * 40;

const settings: TimecodeSettings = {
  enabled: true,
  deviceLabel: '',
  channel: 1,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 500,
  timers: [
    { id: 'a', name: 'Way Maker', from: tc(1, 0, 0), zero: tc(1, 4, 30) },
    { id: 'b', name: 'Goodness', from: tc(1, 5, 0), zero: tc(1, 9, 0) },
  ],
};

const frame = (h: number, m: number, s: number, f = 0) => ({
  hours: h,
  minutes: m,
  seconds: s,
  frames: f,
  dropFrame: false,
  fps: 25,
});

describe('findActiveTimecodeTimer()', () => {
  it('finds the range the timecode is in', () => {
    expect(findActiveTimecodeTimer(settings.timers, tc(1, 4, 0))).toMatchObject({
      timer: { id: 'a' },
      remaining: 30000,
    });
    expect(findActiveTimecodeTimer(settings.timers, tc(1, 6, 0))).toMatchObject({
      timer: { id: 'b' },
      remaining: 180000,
    });
  });

  it('lets go at zero and outside every range', () => {
    expect(findActiveTimecodeTimer(settings.timers, tc(1, 4, 30))).toBeNull();
    expect(findActiveTimecodeTimer(settings.timers, tc(0, 59, 59))).toBeNull();
    expect(findActiveTimecodeTimer(settings.timers, tc(1, 4, 45))).toBeNull();
  });
});

describe('isValidFrame()', () => {
  it('accepts a real frame and refuses anything else', () => {
    expect(isValidFrame(frame(1, 2, 3, 4))).toBe(true);
    expect(isValidFrame({ ...frame(1, 2, 3, 4), fps: 50 })).toBe(false);
    expect(isValidFrame({ ...frame(1, 2, 3, 4), minutes: 61 })).toBe(false);
    expect(isValidFrame('01:02:03:04')).toBe(false);
    expect(isValidFrame(null)).toBe(false);
  });
});

describe('TimecodeService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function lastState(): Promise<TimecodeState> {
    const { countdownService } = await import('../../countdown-service/CountdownService.js');
    return vi.mocked(countdownService.update).mock.calls.at(-1)?.[1] as TimecodeState;
  }

  it('counts down while the timecode is in a range, and hands back when the signal stops', async () => {
    const { timecodeService } = await import('../TimecodeService.js');
    timecodeService.init(settings);

    timecodeService.receiveFrame(frame(1, 4, 0));
    let state = await lastState();
    expect(state).toMatchObject({ signal: true, connected: true, cueName: 'Way Maker', remaining: 30000, fps: 25 });

    // frames keep coming: the countdown follows them
    vi.advanceTimersByTime(200);
    timecodeService.receiveFrame(frame(1, 4, 20));
    state = await lastState();
    expect(state).toMatchObject({ cueName: 'Way Maker', remaining: 10000, phase: 'danger' });

    // the transport stops: no more frames, and past the timeout the countdown lets go
    vi.advanceTimersByTime(700);
    state = await lastState();
    expect(state).toMatchObject({ signal: false, connected: false, duration: 0, remaining: 0 });

    timecodeService.shutdown();
  });

  it('ignores frames while disabled', async () => {
    const { timecodeService } = await import('../TimecodeService.js');
    timecodeService.init({ ...settings, enabled: false });
    timecodeService.receiveFrame(frame(1, 4, 0));
    expect(timecodeService.getState()).toMatchObject({ enabled: false, signal: false, current: null });
  });

  it('keeps what the reader last said about itself', async () => {
    const { timecodeService } = await import('../TimecodeService.js');
    timecodeService.init(settings);
    timecodeService.receiveReaderStatus({
      devices: ['Dante Virtual Soundcard'],
      deviceLabel: 'Dante Virtual Soundcard',
      channel: 1,
      level: 0.4,
      error: '',
    });
    expect(timecodeService.getState().reader).toMatchObject({
      connected: true,
      deviceLabel: 'Dante Virtual Soundcard',
      level: 0.4,
    });

    vi.advanceTimersByTime(3500);
    expect(timecodeService.getState().reader?.connected).toBe(false);
    timecodeService.shutdown();
  });
});

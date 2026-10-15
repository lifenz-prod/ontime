import { deriveMittiTimes, emptyCueTimes, isCueUnderway, parseMittiLabel, parseMittiTimecode } from '../mittiUtils.js';

describe('parseMittiTimecode()', () => {
  it('reads the countdown Mitti sends for the playing cue', () => {
    expect(parseMittiTimecode('-00:04:12')).toBe(252000);
  });

  it('gives an hour its full value', () => {
    // the Companion module multiplies hours by 120 here, which we are deliberately not copying
    expect(parseMittiTimecode('-01:00:00')).toBe(3600000);
    expect(parseMittiTimecode('01:02:03')).toBe(3723000);
  });

  it('drops the frames field', () => {
    expect(parseMittiTimecode('-00:00:12:03')).toBe(12000);
    expect(parseMittiTimecode('00:00:12:29')).toBe(12000);
  });

  it('returns null for anything that is not a timecode', () => {
    expect(parseMittiTimecode('-')).toBeNull();
    expect(parseMittiTimecode('')).toBeNull();
    expect(parseMittiTimecode('none')).toBeNull();
    expect(parseMittiTimecode('00:70:00')).toBeNull();
    expect(parseMittiTimecode(12)).toBeNull();
    expect(parseMittiTimecode(undefined)).toBeNull();
  });
});

describe('parseMittiLabel()', () => {
  it('turns Mitti`s empty placeholder into an empty string', () => {
    expect(parseMittiLabel('-')).toBe('');
  });

  it('trims a name', () => {
    expect(parseMittiLabel('  Opener  ')).toBe('Opener');
  });

  it('returns an empty string for a non string', () => {
    expect(parseMittiLabel(0)).toBe('');
    expect(parseMittiLabel(undefined)).toBe('');
  });
});

describe('deriveMittiTimes()', () => {
  it('uses the values Mitti sent when it has sent all of them', () => {
    const times = deriveMittiTimes({
      ...emptyCueTimes(),
      trt: 300000,
      elapsed: 48000,
      timeLeft: 252000,
    });
    expect(times).toStrictEqual({ duration: 300000, elapsed: 48000, remaining: 252000 });
  });

  it('infers the duration from elapsed and remaining', () => {
    const times = deriveMittiTimes({ ...emptyCueTimes(), elapsed: 48000, timeLeft: 252000 });
    expect(times).toStrictEqual({ duration: 300000, elapsed: 48000, remaining: 252000 });
  });

  it('infers the remaining time from the duration and elapsed', () => {
    const times = deriveMittiTimes({ ...emptyCueTimes(), trt: 300000, elapsed: 48000 });
    expect(times).toStrictEqual({ duration: 300000, elapsed: 48000, remaining: 252000 });
  });

  it('infers the elapsed time from the duration and remaining', () => {
    const times = deriveMittiTimes({ ...emptyCueTimes(), trt: 300000, timeLeft: 252000 });
    expect(times).toStrictEqual({ duration: 300000, elapsed: 48000, remaining: 252000 });
  });

  it('is all zeroes when Mitti has told us nothing', () => {
    expect(deriveMittiTimes(emptyCueTimes())).toStrictEqual({ duration: 0, elapsed: 0, remaining: 0 });
  });

  it('does not go negative when the cue has overrun its stated duration', () => {
    const times = deriveMittiTimes({ ...emptyCueTimes(), trt: 300000, elapsed: 320000 });
    expect(times.remaining).toBe(0);
  });
});

describe('isCueUnderway()', () => {
  it('counts a cue Mitti says is playing', () => {
    expect(isCueUnderway({ ...emptyCueTimes(), isPlaying: true })).toBe(true);
  });

  it('does not count a cue that is only cued up', () => {
    // Mitti loads the selected cue and reports its full duration before anyone has played it
    const cued = { ...emptyCueTimes(), cueName: 'Sermon Bumper', trt: 300000, timeLeft: 300000, elapsed: 0 };
    expect(isCueUnderway(cued)).toBe(false);
  });

  it('counts a cue paused part way through, as QLab would', () => {
    const paused = { ...emptyCueTimes(), trt: 300000, elapsed: 48000, timeLeft: 252000, isPlaying: false };
    expect(isCueUnderway(paused)).toBe(true);
  });
});

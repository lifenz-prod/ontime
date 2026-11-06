import { formatTimecode, parseTimecode, timecodeToMs } from './timecode';

describe('timecodeToMs()', () => {
  it('counts frames at the frame rate', () => {
    expect(timecodeToMs({ hours: 1, minutes: 2, seconds: 3, frames: 5, fps: 25 })).toBe(3723200);
    expect(timecodeToMs({ hours: 0, minutes: 0, seconds: 0, frames: 15, fps: 30 })).toBe(500);
  });
});

describe('formatTimecode()', () => {
  it('shows hh:mm:ss:ff', () => {
    expect(formatTimecode(3723200, 25)).toBe('01:02:03:05');
    expect(formatTimecode(3723000)).toBe('01:02:03');
  });

  it('never shows a frame past the last one in a second', () => {
    expect(formatTimecode(999.9, 25)).toBe('00:00:00:24');
  });
});

describe('parseTimecode()', () => {
  it('reads hh:mm:ss:ff and hh:mm:ss', () => {
    expect(parseTimecode('01:02:03:05', 25)).toBe(3723200);
    expect(parseTimecode('1:02:03', 25)).toBe(3723000);
    expect(parseTimecode('00:00:00;15', 30)).toBe(500);
  });

  it('round trips with formatTimecode', () => {
    expect(parseTimecode(formatTimecode(3723200, 25), 25)).toBe(3723200);
  });

  it('refuses what it cannot read', () => {
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('01:02')).toBeNull();
    expect(parseTimecode('25:00:00:00')).toBeNull();
    expect(parseTimecode('00:00:00:25', 25)).toBeNull();
  });
});

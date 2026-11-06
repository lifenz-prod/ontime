import { formatClipTime, parseClipTime } from './abletonPanel.utils';

describe('formatClipTime()', () => {
  it('shows minutes and seconds', () => {
    expect(formatClipTime(205000)).toBe('3:25');
    expect(formatClipTime(5000)).toBe('0:05');
  });

  it('rounds down to the second, like a clip ruler', () => {
    expect(formatClipTime(205999)).toBe('3:25');
  });

  it('adds hours past the hour', () => {
    expect(formatClipTime(3723000)).toBe('1:02:03');
  });
});

describe('parseClipTime()', () => {
  it('reads m:ss and h:mm:ss', () => {
    expect(parseClipTime('3:25')).toBe(205000);
    expect(parseClipTime('1:02:03')).toBe(3723000);
  });

  it('reads a bare number as seconds, and a fraction on the seconds', () => {
    expect(parseClipTime('90')).toBe(90000);
    expect(parseClipTime('3:25.5')).toBe(205500);
  });

  it('refuses what it cannot read', () => {
    expect(parseClipTime('')).toBeNull();
    expect(parseClipTime('abc')).toBeNull();
    expect(parseClipTime('1:2:3:4')).toBeNull();
    expect(parseClipTime('1.5:00')).toBeNull();
  });

  it('round trips with formatClipTime', () => {
    expect(parseClipTime(formatClipTime(205000))).toBe(205000);
  });
});

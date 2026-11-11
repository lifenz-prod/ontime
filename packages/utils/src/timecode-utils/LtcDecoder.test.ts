import type { TimecodeFrame } from 'ontime-types';

import { LtcDecoder } from './LtcDecoder';
import { LtcEncoder } from './LtcEncoder';

const start = (fps: number, overrides: Partial<TimecodeFrame> = {}): TimecodeFrame => ({
  hours: 1,
  minutes: 2,
  seconds: 3,
  frames: 4,
  dropFrame: false,
  fps,
  ...overrides,
});

/** runs `seconds` of generated LTC through a decoder in worklet-sized blocks */
function decode(
  encoder: LtcEncoder,
  decoder: LtcDecoder,
  sampleRate: number,
  seconds: number,
  shape: (block: Float32Array) => void = () => {},
): TimecodeFrame[] {
  const frames: TimecodeFrame[] = [];
  const block = new Float32Array(128);
  const blocks = Math.ceil((sampleRate * seconds) / block.length);
  for (let b = 0; b < blocks; b++) {
    encoder.fill(block);
    shape(block);
    decoder.process(block, (frame) => frames.push(frame));
  }
  return frames;
}

const label = (f: TimecodeFrame) => `${f.hours}:${f.minutes}:${f.seconds}:${f.frames}`;

describe('LtcDecoder', () => {
  it.each([
    [25, 48000],
    [30, 48000],
    [24, 48000],
    [25, 44100],
    [30, 44100],
  ])('reads %d fps at %d Hz, frame after frame, and works out the rate', (fps, sampleRate) => {
    const encoder = new LtcEncoder(sampleRate, start(fps));
    const decoder = new LtcDecoder(sampleRate);

    const frames = decode(encoder, decoder, sampleRate, 3);

    // it needs a frame or two to lock on, then gets every one
    expect(frames.length).toBeGreaterThanOrEqual(fps * 3 - 3);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      const ms = (f: TimecodeFrame) => ((f.hours * 60 + f.minutes) * 60 + f.seconds) * fps + f.frames;
      expect(ms(b) - ms(a)).toBe(1);
    }
    expect(frames.at(-1)?.fps).toBe(fps);
  });

  it('reads the drop frame flag', () => {
    const encoder = new LtcEncoder(48000, start(30, { dropFrame: true }));
    const frames = decode(encoder, new LtcDecoder(48000), 48000, 0.5);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((f) => f.dropFrame)).toBe(true);
  });

  it('follows a jump straight away', () => {
    const encoder = new LtcEncoder(48000, start(25));
    const decoder = new LtcDecoder(48000);
    decode(encoder, decoder, 48000, 1);

    encoder.jumpTo(start(25, { hours: 2, minutes: 30, seconds: 0, frames: 0 }));
    const after = decode(encoder, decoder, 48000, 0.2).map(label);
    // the frame that was on air when we jumped finishes first, then the new timecode follows at once
    expect(after.slice(0, 3)).toEqual(['1:2:4:3', '2:30:0:0', '2:30:0:1']);
  });

  it('copes with a quiet, inverted and slightly noisy line', () => {
    const encoder = new LtcEncoder(48000, start(25), 0.05);
    let seed = 1;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.004;
    };
    const frames = decode(encoder, new LtcDecoder(48000), 48000, 2, (block) => {
      for (let i = 0; i < block.length; i++) block[i] = -block[i] + noise();
    });
    expect(frames.length).toBeGreaterThanOrEqual(47);
  });

  it('finds nothing in silence or in a tone', () => {
    const decoder = new LtcDecoder(48000);
    const frames: TimecodeFrame[] = [];
    const block = new Float32Array(48000);
    decoder.process(block, (f) => frames.push(f));
    for (let i = 0; i < block.length; i++) block[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
    decoder.process(block, (f) => frames.push(f));
    expect(frames).toEqual([]);
  });
});

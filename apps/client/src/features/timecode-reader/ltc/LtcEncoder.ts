import type { TimecodeFrame } from 'ontime-types';

const syncWord = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

/** Lays out one frame's 80 bits, least significant bit first, as LTC sends them */
export function frameToBits(frame: Omit<TimecodeFrame, 'fps'>): number[] {
  const bits = new Array<number>(80).fill(0);
  const write = (start: number, length: number, value: number) => {
    for (let i = 0; i < length; i++) {
      bits[start + i] = (value >> i) & 1;
    }
  };
  write(0, 4, frame.frames % 10);
  write(8, 2, Math.floor(frame.frames / 10));
  bits[10] = frame.dropFrame ? 1 : 0;
  write(16, 4, frame.seconds % 10);
  write(24, 3, Math.floor(frame.seconds / 10));
  write(32, 4, frame.minutes % 10);
  write(40, 3, Math.floor(frame.minutes / 10));
  write(48, 4, frame.hours % 10);
  write(56, 2, Math.floor(frame.hours / 10));
  syncWord.forEach((bit, i) => (bits[64 + i] = bit));
  return bits;
}

/** The frame after this one, rolling seconds, minutes and hours over */
export function nextFrame(frame: TimecodeFrame): TimecodeFrame {
  let { hours, minutes, seconds, frames } = frame;
  frames++;
  if (frames >= frame.fps) {
    frames = 0;
    seconds++;
  }
  if (seconds >= 60) {
    seconds = 0;
    minutes++;
  }
  if (minutes >= 60) {
    minutes = 0;
    hours = (hours + 1) % 24;
  }
  return { ...frame, hours, minutes, seconds, frames };
}

/**
 * Generates LTC audio: a test signal for the reader, and what the decoder's tests feed it.
 * Keeps its own phase between calls, so it can fill an audio buffer a block at a time.
 */
export class LtcEncoder {
  private frame: TimecodeFrame;
  private readonly samplesPerBit: number;
  private bits: number[];
  private bitIndex = 0;
  private positionInBit = 0;
  private level = 1;
  private readonly amplitude: number;

  constructor(sampleRate: number, start: TimecodeFrame, amplitude = 0.5) {
    this.frame = start;
    this.samplesPerBit = sampleRate / (80 * start.fps);
    this.bits = frameToBits(start);
    this.amplitude = amplitude;
  }

  /** the frame that will be sent next */
  getFrame(): TimecodeFrame {
    return this.frame;
  }

  /** jumps to another timecode at the start of the next frame, as a scrub would */
  jumpTo(frame: TimecodeFrame) {
    this.frame = frame;
    this.bits = frameToBits(frame);
    this.bitIndex = 0;
    this.positionInBit = 0;
  }

  fill(out: Float32Array) {
    const half = this.samplesPerBit / 2;
    for (let i = 0; i < out.length; i++) {
      out[i] = this.level * this.amplitude;

      const before = this.positionInBit;
      this.positionInBit += 1;

      // a 1 flips again half way through its bit
      if (this.bits[this.bitIndex] === 1 && before < half && this.positionInBit >= half) {
        this.level = -this.level;
      }

      if (this.positionInBit >= this.samplesPerBit) {
        // carry the fraction over, so the bit rate stays exact at any sample rate
        this.positionInBit -= this.samplesPerBit;
        this.bitIndex++;
        if (this.bitIndex >= 80) {
          this.bitIndex = 0;
          this.frame = nextFrame(this.frame);
          this.bits = frameToBits(this.frame);
        }
        // every bit starts with a flip
        this.level = -this.level;
      }
    }
  }
}

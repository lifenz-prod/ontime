import type { TimecodeFrame } from 'ontime-types';

/**
 * The 16 bits that end every LTC frame, in the order they arrive when the tape runs forward.
 * Played backwards they arrive reversed, which is how we tell the two apart.
 */
const syncWord = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
const frameBits = 80;

/** LTC carries 80 bits per frame, so the bit rate gives the frame rate away before we have seen a whole second */
const standardRates = [24, 25, 30];

/**
 * Decodes linear timecode (SMPTE LTC) from audio samples.
 *
 * LTC is biphase mark coded: the level flips at the start of every bit, and a 1 flips again
 * half way through. So the signal is a run of long and short gaps between zero crossings: a long
 * gap is a 0, two short gaps a 1. We time the gaps against a running estimate of the bit length,
 * which follows whatever rate (and wobble) the sender has, collect bits until the sync word turns
 * up, and read the frame out of the 64 bits before it.
 *
 * It is fed in blocks of any size and keeps its state between them, so it can sit in an
 * AudioWorklet and see 128 samples at a time.
 */
export class LtcDecoder {
  private readonly sampleRate: number;

  /** samples per bit, refined as we go: starts at 25 fps */
  private bitLength: number;
  private level: 1 | -1 = 1;
  private gap = 0;
  private halfPending = false;
  private bits: number[] = [];

  /** running peak, so the switching threshold follows the signal's level */
  private peak = 0;
  private readonly peakDecay: number;

  private highestFrameSeen = -1;
  private framesSinceRateCheck = 0;
  private lastFrames = -1;

  /** total samples processed, so a frame can say when it ended */
  private sampleCount = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.bitLength = sampleRate / (frameBits * 25);
    // the peak halves in about a tenth of a second, so a level change settles quickly
    this.peakDecay = Math.pow(0.5, 1 / (sampleRate * 0.1));
  }

  /** the loudest sample in the recent past, 0 to 1 */
  getPeak(): number {
    return this.peak;
  }

  /**
   * Feeds a block of samples. Calls onFrame for every whole frame found, with the frame and the
   * sample count at which it ended.
   */
  process(samples: Float32Array, onFrame: (frame: TimecodeFrame, endedAtSample: number) => void) {
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const magnitude = Math.abs(sample);
      this.peak = magnitude > this.peak ? magnitude : this.peak * this.peakDecay;

      this.gap++;
      this.sampleCount++;

      // hysteresis: a crossing only counts once the signal is well past zero on the other side,
      // so noise on a quiet line does not read as bits
      const threshold = Math.max(this.peak * 0.25, 0.005);
      if (this.level === 1 && sample < -threshold) {
        this.level = -1;
        this.onTransition(onFrame);
      } else if (this.level === -1 && sample > threshold) {
        this.level = 1;
        this.onTransition(onFrame);
      }

      // a long silence: whatever we were in the middle of is gone
      if (this.gap > this.bitLength * 4) {
        this.resetBits();
      }
    }
  }

  private onTransition(onFrame: (frame: TimecodeFrame, endedAtSample: number) => void) {
    const gap = this.gap;
    this.gap = 0;

    if (gap < this.bitLength * 0.25 || gap > this.bitLength * 1.6) {
      // too short to be a half bit or too long to be a whole one: not LTC, or not yet locked
      this.resetBits();
      this.relearnBitLength(gap);
      return;
    }

    if (gap < this.bitLength * 0.75) {
      // half a bit
      this.bitLength = this.bitLength * 0.95 + gap * 2 * 0.05;
      if (this.halfPending) {
        this.halfPending = false;
        this.pushBit(1, onFrame);
      } else {
        this.halfPending = true;
      }
      return;
    }

    // a whole bit
    this.bitLength = this.bitLength * 0.95 + gap * 0.05;
    if (this.halfPending) {
      // we paired the halves the wrong way round: drop the stray half and carry on
      this.halfPending = false;
    }
    this.pushBit(0, onFrame);
  }

  /**
   * When gaps keep falling outside what we expect, the sender is at a rate we have not guessed:
   * jump the estimate to the nearest standard rate that fits this gap as a whole bit
   */
  private relearnBitLength(gap: number) {
    let best = this.bitLength;
    let bestError = Infinity;
    for (const fps of standardRates) {
      const candidate = this.sampleRate / (frameBits * fps);
      for (const multiple of [1, 0.5]) {
        const error = Math.abs(gap - candidate * multiple) / candidate;
        if (error < bestError) {
          bestError = error;
          best = candidate;
        }
      }
    }
    if (bestError < 0.2) {
      this.bitLength = best;
    }
  }

  private resetBits() {
    this.bits = [];
    this.halfPending = false;
  }

  private pushBit(bit: number, onFrame: (frame: TimecodeFrame, endedAtSample: number) => void) {
    this.bits.push(bit);
    if (this.bits.length > frameBits) {
      this.bits.shift();
    }
    if (this.bits.length < frameBits) {
      return;
    }

    for (let i = 0; i < syncWord.length; i++) {
      if (this.bits[64 + i] !== syncWord[i]) {
        return;
      }
    }

    const frame = this.readFrame(this.bits);
    // start collecting the next frame from scratch: the sync word cannot overlap it
    this.bits = [];
    if (frame) {
      onFrame(frame, this.sampleCount);
    }
  }

  private readFrame(bits: number[]): TimecodeFrame | null {
    const read = (start: number, length: number) => {
      let value = 0;
      for (let i = 0; i < length; i++) {
        value |= bits[start + i] << i;
      }
      return value;
    };

    const frames = read(0, 4) + read(8, 2) * 10;
    const dropFrame = bits[10] === 1;
    const seconds = read(16, 4) + read(24, 3) * 10;
    const minutes = read(32, 4) + read(40, 3) * 10;
    const hours = read(48, 4) + read(56, 2) * 10;

    if (frames > 29 || seconds > 59 || minutes > 59 || hours > 23) {
      return null;
    }

    return { hours, minutes, seconds, frames, dropFrame, fps: this.frameRate(frames, dropFrame) };
  }

  /**
   * Works out the frame rate. The highest frame number seen over a second or so is the surest
   * sign (23, 24 or 29); until we have seen that many, the bit rate tells us.
   */
  private frameRate(frames: number, dropFrame: boolean): number {
    if (dropFrame) return 30;

    // a new second has begun: settle on what the last one reached
    if (frames < this.lastFrames) {
      this.framesSinceRateCheck++;
    }
    this.lastFrames = frames;
    this.highestFrameSeen = Math.max(this.highestFrameSeen, frames);

    if (this.framesSinceRateCheck >= 2) {
      if (this.highestFrameSeen >= 29) return 30;
      if (this.highestFrameSeen >= 24) return 25;
      if (this.highestFrameSeen >= 23) return 24;
    }

    const fromBitRate = this.sampleRate / this.bitLength / frameBits;
    return standardRates.reduce((best, fps) =>
      Math.abs(fps - fromBitRate) < Math.abs(best - fromBitRate) ? fps : best,
    );
  }
}

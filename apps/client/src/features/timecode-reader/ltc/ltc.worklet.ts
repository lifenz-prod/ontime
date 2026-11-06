/**
 * Audio worklet processors for the timecode reader. Runs on the audio thread, so the decoder
 * keeps pace with the signal however busy the page is.
 *
 * - ltc-reader decodes one input channel and posts each frame, and the level a few times a second
 * - ltc-generator plays generated LTC, the reader's built-in test signal
 */
import type { TimecodeFrame } from 'ontime-types';

import { LtcDecoder } from './LtcDecoder';
import { LtcEncoder } from './LtcEncoder';

// the worklet scope is not in the DOM typings: just what we use of it
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: unknown): void;

type ReaderOptions = { processorOptions?: { channel?: number } };

class LtcReaderProcessor extends AudioWorkletProcessor {
  private readonly decoder = new LtcDecoder(sampleRate);
  private readonly channel: number;
  private samplesSinceLevel = 0;
  private peakSinceLevel = 0;

  constructor(options: ReaderOptions) {
    super(options);
    this.channel = Math.max(0, options.processorOptions?.channel ?? 0);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const samples = input?.[this.channel];
    if (samples) {
      this.decoder.process(samples, (frame: TimecodeFrame) => this.port.postMessage({ type: 'frame', frame }));
      this.peakSinceLevel = Math.max(this.peakSinceLevel, this.decoder.getPeak());
    }

    this.samplesSinceLevel += 128;
    if (this.samplesSinceLevel >= sampleRate / 4) {
      this.port.postMessage({ type: 'level', level: this.peakSinceLevel, channels: input?.length ?? 0 });
      this.samplesSinceLevel = 0;
      this.peakSinceLevel = 0;
    }
    // keep running even while the input is silent
    return true;
  }
}

type GeneratorOptions = { processorOptions?: { start?: TimecodeFrame } };

class LtcGeneratorProcessor extends AudioWorkletProcessor {
  private readonly encoder: LtcEncoder;

  constructor(options: GeneratorOptions) {
    super(options);
    const start = options.processorOptions?.start ?? {
      hours: 1,
      minutes: 0,
      seconds: 0,
      frames: 0,
      dropFrame: false,
      fps: 25,
    };
    this.encoder = new LtcEncoder(sampleRate, start);
    this.port.onmessage = (event: MessageEvent<{ type: string; frame: TimecodeFrame }>) => {
      if (event.data?.type === 'jump') this.encoder.jumpTo(event.data.frame);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channel = outputs[0]?.[0];
    if (channel) {
      this.encoder.fill(channel);
      // the same signal on every output channel, so whichever channel the reader picks has it
      for (let i = 1; i < outputs[0].length; i++) outputs[0][i].set(channel);
    }
    return true;
  }
}

registerProcessor('ltc-reader', LtcReaderProcessor);
registerProcessor('ltc-generator', LtcGeneratorProcessor);

import { ChildProcess, execFile, spawn } from 'node:child_process';

import { LogOrigin, TimecodeFrame, TimecodeReaderStatus, TimecodeSettings } from 'ontime-types';
import { LtcDecoder } from 'ontime-utils';

import { logger } from '../../classes/Logger.js';

/** How to run the ltc-capture helper: the binary, plus any arguments that come before ours */
export type CaptureHelper = { command: string; args?: string[] };

type Sink = {
  frame: (frame: TimecodeFrame) => void;
  status: (status: TimecodeReaderStatus) => void;
};

type Wanted = { deviceLabel: string; channel: number };

/** while reading, how often we tell the service how we are doing, and look for new inputs */
const statusInterval = 1000;
const listInterval = 10000;
/** wait before trying again after the helper stops, longer when it said the input is not there */
const retryDelay = 2000;
const missingInputRetryDelay = 5000;
/** exit codes from ltc-capture: the input or channel is not there; the input went away */
const exitMissingInput = 3;

/**
 * Reads timecode in the desktop app on macOS, with any channel of any input.
 *
 * The browser reader cannot do this: Chromium gives a page at most two channels of an input,
 * and a Dante Virtual Soundcard has up to 64. So we run ltc-capture (apps/electron/native), which
 * opens the input through CoreAudio and streams just the chosen channel to us, and decode it here.
 */
export class NativeTimecodeReader {
  private readonly helper: CaptureHelper;
  private readonly sink: Sink;

  private wanted: Wanted | null = null;
  private child: ChildProcess | null = null;
  private running: (Wanted & { device: string; sampleRate: number }) | null = null;
  private decoder: LtcDecoder | null = null;
  private leftover: Buffer = Buffer.alloc(0);
  private peak = 0;
  private error = '';
  private devices: { name: string; channels: number }[] = [];

  private retryTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private listTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(helper: CaptureHelper, sink: Sink) {
    this.helper = helper;
    this.sink = sink;
  }

  /**
   * Follows the settings from here on. Nothing runs while timecode is turned off: no helper, no
   * polling for inputs, so a Mac that is not using timecode pays nothing for it.
   */
  start(settings: TimecodeSettings) {
    this.stopped = false;
    this.apply(settings, true);
  }

  /** Follows a settings change: starts, stops or moves to another input or channel */
  apply(settings: TimecodeSettings, force = false) {
    const next: Wanted | null = settings.enabled
      ? { deviceLabel: settings.deviceLabel, channel: settings.channel }
      : null;
    if (!force && sameWanted(next, this.wanted)) return;
    this.wanted = next;
    if (next) {
      this.error = '';
      this.startPolling();
      this.restart(0);
    } else {
      this.stopPolling();
      this.restart(0);
      this.devices = [];
      this.error = 'Timecode is turned off in settings';
      this.reportStatus();
    }
  }

  stop() {
    this.stopped = true;
    this.wanted = null;
    this.stopCapture();
    this.stopPolling();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPolling() {
    if (this.statusTimer || this.stopped) return;
    this.refreshDevices();
    this.listTimer = setInterval(() => this.refreshDevices(), listInterval);
    this.statusTimer = setInterval(() => this.reportStatus(), statusInterval);
  }

  private stopPolling() {
    if (this.listTimer) clearInterval(this.listTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.listTimer = null;
    this.statusTimer = null;
  }

  private restart(delay: number) {
    this.stopCapture();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.wanted || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startCapture();
    }, delay);
  }

  private startCapture() {
    const wanted = this.wanted;
    if (!wanted) return;

    const child = spawn(
      this.helper.command,
      [...(this.helper.args ?? []), 'capture', wanted.deviceLabel, String(wanted.channel)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.child = child;
    this.leftover = Buffer.alloc(0);
    this.decoder = null;

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      let newline = stderr.indexOf('\n');
      while (newline >= 0) {
        this.handleReport(child, stderr.slice(0, newline), wanted);
        stderr = stderr.slice(newline + 1);
        newline = stderr.indexOf('\n');
      }
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child === child) this.handleSamples(chunk);
    });

    child.on('error', (error) => {
      if (this.child !== child) return;
      this.setError(`Could not start the timecode reader: ${error.message}`);
      this.child = null;
      this.restart(missingInputRetryDelay);
    });

    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.running = null;
      this.decoder = null;
      if (!this.error) this.setError('The timecode reader stopped');
      this.restart(code === exitMissingInput ? missingInputRetryDelay : retryDelay);
    });
  }

  private handleReport(child: ChildProcess, line: string, wanted: Wanted) {
    if (this.child !== child || !line.trim()) return;
    let report: Record<string, unknown>;
    try {
      report = JSON.parse(line);
    } catch {
      return;
    }
    if (report.event === 'started' && typeof report.sampleRate === 'number' && report.sampleRate > 0) {
      const device = typeof report.device === 'string' ? report.device : wanted.deviceLabel;
      this.running = { ...wanted, device, sampleRate: report.sampleRate };
      this.decoder = new LtcDecoder(report.sampleRate);
      this.error = '';
      logger.info(LogOrigin.Rx, `Timecode: reading ${device}, channel ${wanted.channel}`);
      this.reportStatus();
    } else if (report.event === 'error' && typeof report.message === 'string') {
      this.setError(report.message);
    }
  }

  private handleSamples(chunk: Buffer) {
    const decoder = this.decoder;
    if (!decoder) return;
    const bytes = this.leftover.length ? Buffer.concat([this.leftover, chunk]) : chunk;
    const usable = bytes.length - (bytes.length % 4);
    this.leftover = Buffer.from(bytes.subarray(usable));
    if (usable === 0) return;

    // copy into an aligned buffer: a Float32Array cannot start at an odd offset
    const samples = new Float32Array(usable / 4);
    Buffer.from(samples.buffer).set(bytes.subarray(0, usable));
    decoder.process(samples, (frame) => this.sink.frame(frame));
    this.peak = Math.max(this.peak, decoder.getPeak());
  }

  private setError(message: string) {
    if (message !== this.error) {
      logger.warning(LogOrigin.Rx, `Timecode: ${message}`);
    }
    this.error = message;
    this.reportStatus();
  }

  private stopCapture() {
    const child = this.child;
    this.child = null;
    this.running = null;
    this.decoder = null;
    if (child) {
      child.stdin?.end();
      child.kill();
    }
  }

  private refreshDevices() {
    execFile(this.helper.command, [...(this.helper.args ?? []), 'list'], { timeout: 5000 }, (error, stdout) => {
      if (error || this.stopped || !this.wanted) return;
      try {
        const list = JSON.parse(stdout);
        if (Array.isArray(list)) {
          this.devices = list
            .filter((item) => typeof item?.name === 'string' && Number.isInteger(item?.channels))
            .map((item) => ({ name: item.name as string, channels: item.channels as number }));
        }
      } catch {
        // keep the last list
      }
    });
  }

  private reportStatus() {
    if (this.stopped) return;
    const level = this.peak;
    this.peak = 0;
    this.sink.status({
      devices: this.devices.map((device) => device.name),
      deviceChannels: this.devices.map((device) => device.channels),
      deviceLabel: this.running?.device ?? '',
      channel: this.wanted?.channel ?? this.running?.channel ?? 1,
      level: Math.min(1, level),
      error: this.error,
    });
  }
}

function sameWanted(a: Wanted | null, b: Wanted | null): boolean {
  if (a === null || b === null) return a === b;
  return a.deviceLabel === b.deviceLabel && a.channel === b.channel;
}

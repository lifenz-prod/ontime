import { existsSync } from 'node:fs';

import {
  LogOrigin,
  TimecodeReaderStatus,
  TimecodeSettings,
  TimecodeState,
  TimerPhase,
  timecodeStatePlaceholder,
} from 'ontime-types';
import { timecodeToMs } from 'ontime-utils';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';
import { getPhase } from '../ableton-service/abletonUtils.js';
import { countdownService } from '../countdown-service/CountdownService.js';

import {
  findActiveTimecodeTimer,
  isSameTimecodeState,
  isValidFrame,
  parseReaderStatus,
  readerTimeout,
} from './timecodeUtils.js';
import { CaptureHelper, NativeTimecodeReader } from './NativeTimecodeReader.js';

const defaultTimecodeSettings: TimecodeSettings = {
  enabled: false,
  deviceLabel: '',
  channel: 1,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 500,
  timers: [],
};

export { defaultTimecodeSettings };

/** how often we re-check the signal and recompute the countdown between frames */
const tickInterval = 100;

type LastFrame = {
  ms: number;
  receivedAt: number;
  fps: number;
  dropFrame: boolean;
};

/**
 * Follows incoming timecode (LTC) and runs countdowns against it.
 *
 * Frames come from a reader. In the macOS desktop app that is NativeTimecodeReader, which records
 * any channel of any input through a small CoreAudio helper (the app points ONTIME_LTC_CAPTURE at
 * it). Everywhere else a timecode reader page (hidden inside the desktop app, or open in any
 * browser on a machine with the signal) decodes the audio and sends us each frame over the
 * websocket, which keeps sound card access out of the server on the CLI and Docker.
 *
 * Each timer covers a range of timecode and counts down to its zero point. While the timecode is
 * in that range it takes over the playback countdown, and it hands back once the timecode passes
 * zero, leaves the range, or stops arriving.
 */
class TimecodeService {
  private settings: TimecodeSettings = { ...defaultTimecodeSettings };
  private tickTimer: NodeJS.Timeout | null = null;
  private lastFrame: LastFrame | null = null;
  private reader: (TimecodeReaderStatus & { receivedAt: number }) | null = null;
  private hadSignal = false;
  private currentState: TimecodeState = { ...timecodeStatePlaceholder };
  private nativeReader: NativeTimecodeReader | null = null;

  init(settings: TimecodeSettings, helper: CaptureHelper | null = findCaptureHelper()) {
    this.applySettings(settings);
    this.nativeReader?.stop();
    this.nativeReader = null;
    if (helper) {
      this.nativeReader = new NativeTimecodeReader(helper, {
        frame: (frame) => this.receiveFrame(frame),
        status: (status) => this.receiveReaderStatus(status),
      });
      this.nativeReader.start(this.settings);
    }
  }

  updateSettings(settings: TimecodeSettings) {
    this.applySettings(settings);
    this.nativeReader?.apply(this.settings);
  }

  shutdown() {
    this.stopTicking();
    this.nativeReader?.stop();
    this.nativeReader = null;
  }

  getState(): TimecodeState {
    return { ...this.currentState };
  }

  /** the latest timecode, carried forward to now, for "Set to current timecode" */
  getCurrent(): { current: number | null; fps: number | null; signal: boolean } {
    const now = Date.now();
    return {
      current: this.currentPosition(now),
      fps: this.lastFrame?.fps ?? null,
      signal: this.hasSignal(now),
    };
  }

  private applySettings(settings: TimecodeSettings) {
    this.settings = { ...settings, timers: [...settings.timers] };
    if (this.settings.enabled) {
      logger.info(LogOrigin.Rx, 'Timecode: following incoming timecode');
      this.startTicking();
    } else {
      logger.info(LogOrigin.Rx, 'Timecode: Service disabled');
      this.stopTicking();
      this.lastFrame = null;
      this.hadSignal = false;
    }
    this.currentState = { ...timecodeStatePlaceholder, enabled: this.settings.enabled };
    this.refreshState(true);
  }

  private startTicking() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.refreshState(), tickInterval);
  }

  private stopTicking() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** A reader decoded a frame */
  receiveFrame(payload: unknown) {
    if (!this.settings.enabled || !isValidFrame(payload)) {
      return;
    }
    this.lastFrame = {
      ms: timecodeToMs(payload),
      receivedAt: Date.now(),
      fps: payload.fps,
      dropFrame: payload.dropFrame === true,
    };
    this.refreshState();
  }

  /** A reader told us what it is doing */
  receiveReaderStatus(payload: unknown) {
    const status = parseReaderStatus(payload);
    if (!status) return;
    this.reader = { ...status, receivedAt: Date.now() };
    this.refreshState();
  }

  private hasSignal(now: number): boolean {
    return this.lastFrame !== null && now - this.lastFrame.receivedAt < this.settings.timeout;
  }

  /**
   * Where the timecode is now. A frame takes a frame's length to arrive and a little more to reach
   * us, so we carry the last one forward on our own clock; once frames stop, so does this.
   */
  private currentPosition(now: number): number | null {
    if (!this.lastFrame || !this.hasSignal(now)) {
      return this.lastFrame?.ms ?? null;
    }
    return this.lastFrame.ms + (now - this.lastFrame.receivedAt);
  }

  private refreshState(force = false) {
    const now = Date.now();
    const signal = this.settings.enabled && this.hasSignal(now);
    const current = this.currentPosition(now);

    if (signal !== this.hadSignal && this.settings.enabled) {
      logger.info(LogOrigin.Rx, signal ? 'Timecode: signal found' : 'Timecode: signal lost');
      this.hadSignal = signal;
    }

    const active = signal && current !== null ? findActiveTimecodeTimer(this.settings.timers, current) : null;
    const reader =
      this.reader === null
        ? null
        : {
            devices: this.reader.devices,
            ...(this.reader.deviceChannels ? { deviceChannels: this.reader.deviceChannels } : {}),
            deviceLabel: this.reader.deviceLabel,
            channel: this.reader.channel,
            level: this.reader.level,
            error: this.reader.error,
            connected: now - this.reader.receivedAt < readerTimeout,
          };

    const nextState: TimecodeState = {
      enabled: this.settings.enabled,
      connected: signal,
      cueName: active?.timer.name ?? '',
      cueNumber: '',
      duration: active ? active.timer.zero - active.timer.from : 0,
      elapsed: active?.elapsed ?? 0,
      remaining: active?.remaining ?? 0,
      isPaused: false,
      phase: active
        ? getPhase(active.remaining, this.settings.warningThreshold, this.settings.dangerThreshold)
        : TimerPhase.None,
      signal,
      current,
      fps: this.lastFrame?.fps ?? null,
      dropFrame: this.lastFrame?.dropFrame ?? false,
      reader,
    };

    if (!force && isSameTimecodeState(this.currentState, nextState)) {
      return;
    }

    this.currentState = nextState;
    eventStore.set('timecode', this.currentState);
    countdownService.update('timecode', this.currentState);
  }
}

/** The desktop app on macOS ships ltc-capture and tells us where it is */
function findCaptureHelper(): CaptureHelper | null {
  const path = process.env.ONTIME_LTC_CAPTURE;
  return path && existsSync(path) ? { command: path } : null;
}

export const timecodeService = new TimecodeService();

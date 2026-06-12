import { LogOrigin, QlabSettings, QlabState, TimerPhase, qlabStatePlaceholder } from 'ontime-types';

import { toBuffer as oscToBuffer, fromBuffer, type OscPacketOutput } from 'osc-min';
import * as dgram from 'node:dgram';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';

const defaultQlabSettings: QlabSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 53000,
  listenPort: 53001,
  filterByColor: null,
  filterByType: null,
  filterByCueNumber: null,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 3000,
};

export { defaultQlabSettings };

interface QlabCue {
  uniqueID: string;
  number: string;
  listName: string;
  type: string;
  colorName: string;
  // QLab includes these timing fields directly on each cue in the /runningOrPausedCues response
  currentDuration?: number; // seconds (float)
  actionElapsed?: number;   // seconds (float) — elapsed playback time
  isPaused?: boolean;
}

interface PendingCueData {
  uniqueID: string;
  cueName: string;
  cueNumber: string;
  duration: number | null;
  elapsed: number | null;
  isPaused: boolean | null;
}

class QlabService {
  private sendSocket: dgram.Socket | null = null;
  private receiveSocket: dgram.Socket | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private settings: QlabSettings = { ...defaultQlabSettings };
  private lastResponseTime = 0;
  private pendingCue: PendingCueData | null = null;
  private currentState: QlabState = { ...qlabStatePlaceholder };

  init(settings: QlabSettings) {
    this.settings = { ...settings };

    if (!this.settings.enabled) {
      logger.info(LogOrigin.Tx, 'QLab: Service disabled');
      this.broadcastState();
      return;
    }

    this.start();
  }

  updateSettings(settings: QlabSettings) {
    const wasEnabled = this.settings.enabled;
    this.settings = { ...settings };

    if (!this.settings.enabled) {
      this.stop();
      this.currentState = { ...qlabStatePlaceholder };
      this.broadcastState();
      return;
    }

    // restart if was enabled (settings changed) or just became enabled
    if (wasEnabled) {
      this.stop();
    }
    this.start();
  }

  shutdown() {
    this.stop();
  }

  private start() {
    logger.info(LogOrigin.Tx, `QLab: Starting polling to ${this.settings.host}:${this.settings.port}`);

    this.currentState = {
      ...qlabStatePlaceholder,
      enabled: true,
    };
    this.broadcastState();

    // create send socket
    this.sendSocket = dgram.createSocket('udp4');
    this.sendSocket.on('error', (error) => {
      logger.error(LogOrigin.Tx, `QLab send socket error: ${error.message}`);
    });

    // create receive socket
    this.receiveSocket = dgram.createSocket('udp4');
    this.receiveSocket.on('error', (error) => {
      logger.error(LogOrigin.Rx, `QLab receive socket error: ${error.message}`);
    });
    this.receiveSocket.on('message', (buf) => this.handleResponse(buf));

    try {
      this.receiveSocket.bind(this.settings.listenPort, () => {
        logger.info(LogOrigin.Rx, `QLab: Listening for responses on port ${this.settings.listenPort}`);
      });
    } catch (error) {
      logger.error(LogOrigin.Rx, `QLab: Failed to bind receive socket: ${error}`);
      return;
    }

    // start polling
    this.pollInterval = setInterval(() => this.poll(), 250);
  }

  private stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.sendSocket) {
      try {
        this.sendSocket.close();
      } catch {
        // ignore close errors
      }
      this.sendSocket = null;
    }

    if (this.receiveSocket) {
      try {
        this.receiveSocket.close();
      } catch {
        // ignore close errors
      }
      this.receiveSocket = null;
    }

    this.pendingCue = null;
    this.lastResponseTime = 0;

    this.currentState = { ...qlabStatePlaceholder };
    this.broadcastState();

    logger.info(LogOrigin.Tx, 'QLab: Polling stopped');
  }

  private poll() {
    // check for timeout
    if (this.lastResponseTime > 0 && Date.now() - this.lastResponseTime > this.settings.timeout) {
      if (this.currentState.connected) {
        logger.warning(LogOrigin.Rx, 'QLab: Connection timeout');
        this.currentState = {
          ...qlabStatePlaceholder,
          enabled: true,
          connected: false,
        };
        this.broadcastState();
      }
    }

    // send polling request
    this.sendOSC('/runningOrPausedCues');
  }

  private sendOSC(address: string) {
    if (!this.sendSocket) return;

    const buffer = oscToBuffer({ address, args: [] });
    this.sendSocket.send(buffer, 0, buffer.byteLength, this.settings.port, this.settings.host, (error) => {
      if (error) {
        logger.warning(LogOrigin.Tx, `QLab: Failed to send OSC: ${error.message}`);
      }
    });
  }

  private handleResponse(buf: Buffer) {
    let msg: OscPacketOutput;
    try {
      msg = fromBuffer(buf);
    } catch {
      return;
    }

    if (msg.oscType === 'bundle') {
      return;
    }

    const { address, args } = msg;
    this.lastResponseTime = Date.now();

    // QLab responses have the JSON payload as a string in the first arg
    const jsonString = args[0]?.value;
    if (typeof jsonString !== 'string') {
      return;
    }

    let parsed: { data: unknown };
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return;
    }

    if (address.endsWith('/runningOrPausedCues')) {
      this.handleRunningCues(parsed.data);
    } else if (address.includes('/currentDuration')) {
      this.handleCurrentDuration(parsed.data);
    } else if (address.includes('/actionElapsed')) {
      this.handleActionElapsed(parsed.data);
    } else if (address.includes('/isPaused')) {
      this.handleIsPaused(parsed.data);
    }
  }

  private handleRunningCues(data: unknown) {
    if (!Array.isArray(data) || data.length === 0) {
      // no running cues - clear state
      if (this.currentState.connected && this.currentState.cueName !== '') {
        this.currentState = {
          ...qlabStatePlaceholder,
          enabled: true,
          connected: true,
        };
        this.broadcastState();
      } else if (!this.currentState.connected) {
        this.currentState.connected = true;
        this.currentState.enabled = true;
        this.broadcastState();
      }
      this.pendingCue = null;
      return;
    }

    const cues = data as QlabCue[];
    const filtered = this.filterCues(cues);

    if (filtered.length === 0) {
      this.pendingCue = null;
      if (this.currentState.cueName !== '') {
        this.currentState = {
          ...qlabStatePlaceholder,
          enabled: true,
          connected: true,
        };
        this.broadcastState();
      }
      return;
    }

    const cue = filtered[0];

    // QLab includes actionElapsed, currentDuration, and isPaused directly on each cue
    // in the /runningOrPausedCues response. Use those if available — no extra round-trip needed.
    if (typeof cue.actionElapsed === 'number' && typeof cue.currentDuration === 'number') {
      const duration = Math.round(cue.currentDuration * 1000);
      const elapsed = Math.round(cue.actionElapsed * 1000);
      const isPaused = typeof cue.isPaused === 'boolean' ? cue.isPaused : false;
      const effectiveElapsed = duration > 0 ? elapsed % duration : elapsed;
      const remaining = Math.max(0, duration - effectiveElapsed);
      const phase = this.getPhase(remaining);

      this.currentState = {
        enabled: true,
        connected: true,
        cueName: cue.listName || '',
        cueNumber: cue.number || '',
        duration,
        elapsed: effectiveElapsed,
        remaining,
        isPaused,
        phase,
      };
      this.pendingCue = null;
      this.broadcastState();
      return;
    }

    // Fallback: QLab version doesn't include inline timing data, so query each property
    // individually. Preserve duration/isPaused across polls for the same cue so a slow
    // or missing response doesn't prevent the countdown from updating.
    const isSameCue = this.pendingCue?.uniqueID === cue.uniqueID;
    this.pendingCue = {
      uniqueID: cue.uniqueID,
      cueName: cue.listName || '',
      cueNumber: cue.number || '',
      duration: isSameCue ? (this.pendingCue?.duration ?? null) : null,
      elapsed: null, // always refresh elapsed – it changes every tick
      isPaused: isSameCue ? (this.pendingCue?.isPaused ?? null) : null,
    };

    // Always request elapsed (changes each tick). Only request duration and isPaused
    // for a new cue – they are stable and the responses can be reused across polls.
    this.sendOSC(`/cue_id/${cue.uniqueID}/actionElapsed`);
    if (!isSameCue || this.pendingCue.duration === null) {
      this.sendOSC(`/cue_id/${cue.uniqueID}/currentDuration`);
    }
    if (!isSameCue || this.pendingCue.isPaused === null) {
      this.sendOSC(`/cue_id/${cue.uniqueID}/isPaused`);
    }
  }

  private filterCues(cues: QlabCue[]): QlabCue[] {
    let filtered = cues;

    if (this.settings.filterByColor) {
      const color = this.settings.filterByColor.toLowerCase();
      filtered = filtered.filter((c) => c.colorName?.toLowerCase() === color);
    }

    if (this.settings.filterByType) {
      const type = this.settings.filterByType.toLowerCase();
      filtered = filtered.filter((c) => c.type?.toLowerCase() === type);
    }

    if (this.settings.filterByCueNumber) {
      const num = this.settings.filterByCueNumber;
      filtered = filtered.filter((c) => c.number === num);
    }

    return filtered;
  }

  private handleCurrentDuration(data: unknown) {
    if (this.pendingCue === null || typeof data !== 'number') return;
    // QLab sends seconds (float), convert to milliseconds
    this.pendingCue.duration = Math.round(data * 1000);
    this.tryUpdateState();
  }

  private handleActionElapsed(data: unknown) {
    if (this.pendingCue === null || typeof data !== 'number') return;
    // QLab sends seconds (float), convert to milliseconds
    this.pendingCue.elapsed = Math.round(data * 1000);
    this.tryUpdateState();
  }

  private handleIsPaused(data: unknown) {
    if (this.pendingCue === null || typeof data !== 'boolean') return;
    this.pendingCue.isPaused = data;
    this.tryUpdateState();
  }

  private tryUpdateState() {
    if (this.pendingCue === null) return;
    // We must have at least duration and elapsed to compute a meaningful remaining time.
    // isPaused defaults to false if its response hasn't arrived yet so a slow/missing
    // reply doesn't block the countdown from updating.
    if (this.pendingCue.duration === null || this.pendingCue.elapsed === null) {
      return;
    }

    const { duration, elapsed, cueName, cueNumber } = this.pendingCue;
    const isPaused = this.pendingCue.isPaused ?? false;

    // handle looping cues where elapsed can exceed duration
    const effectiveElapsed = duration > 0 ? elapsed % duration : elapsed;
    const remaining = Math.max(0, duration - effectiveElapsed);

    const phase = this.getPhase(remaining);

    this.currentState = {
      enabled: true,
      connected: true,
      cueName,
      cueNumber,
      duration,
      elapsed: effectiveElapsed,
      remaining,
      isPaused,
      phase,
    };

    this.broadcastState();
  }

  private getPhase(remaining: number): TimerPhase {
    if (remaining <= 0) return TimerPhase.Overtime;
    if (remaining <= this.settings.dangerThreshold) return TimerPhase.Danger;
    if (remaining <= this.settings.warningThreshold) return TimerPhase.Warning;
    return TimerPhase.Default;
  }

  private broadcastState() {
    eventStore.set('qlab', this.currentState);
  }

  getState(): QlabState {
    return { ...this.currentState };
  }
}

export const qlabService = new QlabService();

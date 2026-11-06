import {
  AbletonClipPosition,
  AbletonSettings,
  AbletonState,
  AbletonTimer,
  LogOrigin,
  TimerPhase,
  abletonStatePlaceholder,
} from 'ontime-types';

import { toBuffer as oscToBuffer, fromBuffer, type OscPacketOutput } from 'osc-min';
import * as dgram from 'node:dgram';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';
import { ListenSocket } from '../../utils/listenSocket.js';
import { countdownService } from '../countdown-service/CountdownService.js';

import {
  type ClipReading,
  clipKey,
  clipPositionToMs,
  currentPositionMs,
  defaultTempo,
  findActiveTimer,
  getPhase,
  isSameAbletonState,
  isTimerClipPlaying,
  isTruthyArg,
} from './abletonUtils.js';

const defaultAbletonSettings: AbletonSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 11000,
  listenPort: 11001,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 5000,
  timers: [],
};

export { defaultAbletonSettings };

/** how often we ping Live and re-check whether we are still hearing from it */
const healthInterval = 1000;
/** how often we recompute the countdown */
const tickInterval = 100;
/** how often we ask Live where a playing timer clip is */
const positionPollInterval = 200;
/** how long "Set to current position" waits for Live to answer */
const requestTimeout = 1500;

type OscArg = { type: 'integer'; value: number };

type PendingRequest = {
  address: string;
  prefix: (number | string)[];
  resolve: (args: unknown[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Follows Session View clips in Ableton Live, through the AbletonOSC control surface script.
 *
 * Each timer points at one clip and a time in it. While that clip plays and the time is still
 * ahead, the timer takes over the playback countdown from QLab or Mitti, then hands back once the
 * clip passes it or stops.
 *
 * AbletonOSC replies to whoever spoke to it last, always on port 11001, and only streams changes
 * for properties it has been asked to listen to. We listen for which clip each track is playing
 * and for the tempo and transport, and poll the playing clip's position a few times a second so a
 * scrub is picked up straight away.
 */
class AbletonService {
  private sendSocket: dgram.Socket | null = null;
  private listenSocket: ListenSocket | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private settings: AbletonSettings = { ...defaultAbletonSettings };

  private lastReplyTime = 0;
  private startedAt = 0;
  private lastPositionPoll = 0;
  private hasReportedSilence = false;
  private hasReportedError = false;

  private tempo = defaultTempo;
  private isSongPlaying = false;
  /** 1-based track → 0-based slot index Live says is playing, -1 for none */
  private playingSlots = new Map<number, number>();
  /** clipKey(track, clip), both 1-based */
  private readings = new Map<string, ClipReading>();
  private warping = new Map<string, boolean>();
  private pending: PendingRequest[] = [];

  private currentState: AbletonState = { ...abletonStatePlaceholder };

  init(settings: AbletonSettings) {
    this.settings = { ...settings, timers: [...settings.timers] };

    if (!this.settings.enabled) {
      logger.info(LogOrigin.Rx, 'Ableton: Service disabled');
      this.broadcastState();
      return;
    }

    this.start();
  }

  updateSettings(settings: AbletonSettings) {
    const wasEnabled = this.settings.enabled;
    this.settings = { ...settings, timers: [...settings.timers] };

    if (!this.settings.enabled) {
      if (wasEnabled) this.stop();
      return;
    }

    if (wasEnabled) {
      this.stop();
    }
    this.start();
  }

  shutdown() {
    this.stop();
  }

  getState(): AbletonState {
    return { ...this.currentState };
  }

  private start() {
    logger.info(
      LogOrigin.Rx,
      `Ableton: following AbletonOSC at ${this.settings.host}:${this.settings.port}, replies on port ${this.settings.listenPort}`,
    );

    this.resetLiveState();
    this.currentState = { ...abletonStatePlaceholder, enabled: true };
    this.broadcastState();

    this.sendSocket = dgram.createSocket('udp4');
    this.sendSocket.on('error', (error) => {
      logger.error(LogOrigin.Tx, `Ableton send socket error: ${error.message}`);
    });

    this.listenSocket = new ListenSocket({
      label: 'Ableton',
      port: this.settings.listenPort,
      onMessage: (buf) => this.handlePacket(buf),
      onListening: () => this.subscribe(),
    });

    this.startedAt = Date.now();
    this.hasReportedSilence = false;
    this.hasReportedError = false;

    this.healthTimer = setInterval(() => this.checkHealth(), healthInterval);
    this.tickTimer = setInterval(() => this.tick(), tickInterval);
  }

  private stop() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // leave Live as we found it, without listeners streaming at a port nobody reads
    if (this.sendSocket) {
      this.unsubscribe();
      const socket = this.sendSocket;
      this.sendSocket = null;
      // give the stop_listen messages a moment to leave before the socket goes
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
      }, 50);
    }

    if (this.listenSocket) {
      this.listenSocket.close();
      this.listenSocket = null;
    }

    for (const request of this.pending) {
      clearTimeout(request.timer);
      request.reject(new Error('The Ableton integration stopped'));
    }
    this.pending = [];

    this.resetLiveState();
    this.currentState = { ...abletonStatePlaceholder };
    this.broadcastState();

    logger.info(LogOrigin.Rx, 'Ableton: Stopped');
  }

  private resetLiveState() {
    this.lastReplyTime = 0;
    this.startedAt = 0;
    this.lastPositionPoll = 0;
    this.tempo = defaultTempo;
    this.isSongPlaying = false;
    this.playingSlots.clear();
    this.readings.clear();
    this.warping.clear();
  }

  /** the tracks any timer points at, 1-based */
  private watchedTracks(): number[] {
    return [...new Set(this.settings.timers.map((timer) => timer.track))];
  }

  /** Asks Live to stream what we follow, and for its current values so we are not blank until something changes */
  private subscribe() {
    this.send('/live/test');
    this.send('/live/song/start_listen/tempo');
    this.send('/live/song/get/tempo');
    this.send('/live/song/start_listen/is_playing');
    this.send('/live/song/get/is_playing');

    for (const track of this.watchedTracks()) {
      this.send('/live/track/start_listen/playing_slot_index', [int(track - 1)]);
      this.send('/live/track/get/playing_slot_index', [int(track - 1)]);
    }

    for (const timer of this.settings.timers) {
      this.send('/live/clip/get/warping', [int(timer.track - 1), int(timer.clip - 1)]);
    }
  }

  private unsubscribe() {
    this.send('/live/song/stop_listen/tempo');
    this.send('/live/song/stop_listen/is_playing');
    for (const track of this.watchedTracks()) {
      this.send('/live/track/stop_listen/playing_slot_index', [int(track - 1)]);
    }
  }

  private send(address: string, args: OscArg[] = []) {
    if (!this.sendSocket) return;

    const buffer = oscToBuffer({ address, args });
    this.sendSocket.send(buffer, 0, buffer.byteLength, this.settings.port, this.settings.host, (error) => {
      if (error) {
        logger.warning(LogOrigin.Tx, `Ableton: Failed to send OSC: ${error.message}`);
      }
    });
  }

  private checkHealth() {
    const wasConnected = this.currentState.connected;
    this.send('/live/test');
    this.refreshState();

    if (this.lastReplyTime === 0 && !this.hasReportedSilence && Date.now() - this.startedAt > this.settings.timeout) {
      this.hasReportedSilence = true;
      logger.warning(
        LogOrigin.Rx,
        `Ableton: no reply from ${this.settings.host}:${this.settings.port}. Check Live is open with AbletonOSC selected as a Control Surface, and that this machine can reach it.`,
      );
    }

    // Live came back (or was restarted): its listeners went with it, so ask again
    if (!wasConnected && this.currentState.connected) {
      this.subscribe();
    }
  }

  private tick() {
    const now = Date.now();
    if (now - this.lastPositionPoll >= positionPollInterval) {
      this.lastPositionPoll = now;
      this.pollPlayingClips();
    }
    this.refreshState();
  }

  /** asks for the position of every timer clip that is playing, once per clip */
  private pollPlayingClips() {
    const asked = new Set<string>();
    for (const timer of this.settings.timers) {
      if (!isTimerClipPlaying(timer, this.playingSlots)) continue;
      const key = clipKey(timer.track, timer.clip);
      if (asked.has(key)) continue;
      asked.add(key);
      this.send('/live/clip/get/playing_position', [int(timer.track - 1), int(timer.clip - 1)]);
    }
  }

  private handlePacket(buf: Buffer) {
    let packet: OscPacketOutput;
    try {
      packet = fromBuffer(buf);
    } catch {
      return;
    }

    this.lastReplyTime = Date.now();
    this.handleOscPacket(packet);
  }

  private handleOscPacket(packet: OscPacketOutput) {
    if (packet.oscType === 'bundle') {
      packet.elements.forEach((element) => this.handleOscPacket(element));
      return;
    }

    const { address } = packet;
    if (typeof address !== 'string') return;
    const args = packet.args.map((arg) => (arg as { value?: unknown }).value);

    this.resolvePending(address, args);

    switch (address) {
      case '/live/startup':
        // AbletonOSC was (re)loaded, which drops every listener
        this.subscribe();
        break;
      case '/live/song/get/tempo':
        if (typeof args[0] === 'number' && args[0] > 0) this.tempo = args[0];
        break;
      case '/live/song/get/is_playing':
        this.isSongPlaying = isTruthyArg(args[0]);
        break;
      case '/live/track/get/playing_slot_index': {
        const [trackIndex, slotIndex] = args;
        if (typeof trackIndex !== 'number' || typeof slotIndex !== 'number') break;
        const track = trackIndex + 1;
        const previous = this.playingSlots.get(track);
        this.playingSlots.set(track, slotIndex);
        if (previous !== slotIndex && slotIndex >= 0) {
          // a new clip started: anything we knew about its position is from an earlier play
          this.readings.delete(clipKey(track, slotIndex + 1));
          this.send('/live/clip/get/warping', [int(trackIndex), int(slotIndex)]);
          this.send('/live/clip/get/playing_position', [int(trackIndex), int(slotIndex)]);
        }
        break;
      }
      case '/live/clip/get/playing_position': {
        const [trackIndex, clipIndex, position] = args;
        if (typeof trackIndex !== 'number' || typeof clipIndex !== 'number' || typeof position !== 'number') break;
        this.readings.set(clipKey(trackIndex + 1, clipIndex + 1), { position, receivedAt: Date.now() });
        break;
      }
      case '/live/clip/get/warping': {
        const [trackIndex, clipIndex, warped] = args;
        if (typeof trackIndex !== 'number' || typeof clipIndex !== 'number') break;
        this.warping.set(clipKey(trackIndex + 1, clipIndex + 1), isTruthyArg(warped));
        break;
      }
      case '/live/error':
        // an empty slot or a track that is not there: say it once, it is usually a timer pointing at the wrong place
        if (!this.hasReportedError) {
          this.hasReportedError = true;
          logger.warning(LogOrigin.Rx, `Ableton: AbletonOSC reported an error: ${String(args[0] ?? '')}`);
        }
        break;
      default:
        // /live/test and anything else only tell us Live is there
        break;
    }
  }

  private positionMsFor(timer: AbletonTimer, now: number): number | null {
    const key = clipKey(timer.track, timer.clip);
    const reading = this.readings.get(key);
    if (!reading) return null;
    return currentPositionMs(reading, this.warping.get(key), this.tempo, this.isSongPlaying, now);
  }

  private refreshState() {
    if (!this.settings.enabled) return;

    const now = Date.now();
    const connected = this.lastReplyTime > 0 && now - this.lastReplyTime < this.settings.timeout;
    const active = connected
      ? findActiveTimer(this.settings.timers, this.playingSlots, (timer) => this.positionMsFor(timer, now))
      : null;

    const nextState: AbletonState = active
      ? {
          enabled: true,
          connected,
          cueName: active.timer.name,
          cueNumber: `${active.timer.track}.${active.timer.clip}`,
          duration: active.timer.target,
          elapsed: Math.max(0, active.positionMs),
          remaining: active.remaining,
          isPaused: !this.isSongPlaying,
          phase: getPhase(active.remaining, this.settings.warningThreshold, this.settings.dangerThreshold),
        }
      : {
          ...abletonStatePlaceholder,
          enabled: true,
          connected,
          phase: TimerPhase.None,
        };

    if (isSameAbletonState(this.currentState, nextState)) {
      return;
    }

    if (this.currentState.connected && !connected) {
      logger.warning(LogOrigin.Rx, 'Ableton: No reply from AbletonOSC, check Live is open and reachable');
    }

    this.currentState = nextState;
    this.broadcastState();
  }

  private broadcastState() {
    eventStore.set('ableton', this.currentState);
    countdownService.update('ableton', this.currentState);
  }

  /**
   * Sends a query and waits for the reply that answers it.
   * AbletonOSC echoes the address and the track / clip indexes before the value, which is how we match it.
   */
  private request(address: string, prefix: number[], timeout = requestTimeout): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((request) => request !== entry);
        reject(new Error('Ableton did not answer'));
      }, timeout);
      const entry: PendingRequest = { address, prefix, resolve, reject, timer };
      this.pending.push(entry);
      this.send(
        address,
        prefix.map((value) => int(value)),
      );
    });
  }

  private resolvePending(address: string, args: unknown[]) {
    const matched = this.pending.filter(
      (request) => request.address === address && request.prefix.every((value, index) => args[index] === value),
    );
    for (const request of matched) {
      clearTimeout(request.timer);
      request.resolve(args.slice(request.prefix.length));
    }
    if (matched.length > 0) {
      this.pending = this.pending.filter((request) => !matched.includes(request));
    }
  }

  /**
   * Reads where Live's playhead is in one clip, for "Set to current position".
   * track and clip are 1-based, as the settings show them.
   */
  async readClipPosition(track: number, clip: number): Promise<AbletonClipPosition> {
    if (!this.settings.enabled || !this.sendSocket) {
      throw new Error('Enable the Ableton integration and save first');
    }

    const trackIndex = track - 1;
    const clipIndex = clip - 1;

    let positionReply: unknown[];
    try {
      positionReply = await this.request('/live/clip/get/playing_position', [trackIndex, clipIndex]);
    } catch {
      throw new Error(
        `Ableton did not answer for track ${track}, clip ${clip}. Check AbletonOSC is running, and that there is a clip in that slot.`,
      );
    }

    const optional = (address: string, prefix: number[]) =>
      this.request(address, prefix, 800).catch(() => [] as unknown[]);

    const [warpingReply, tempoReply, slotReply, trackNameReply, clipNameReply] = await Promise.all([
      optional('/live/clip/get/warping', [trackIndex, clipIndex]),
      optional('/live/song/get/tempo', []),
      optional('/live/track/get/playing_slot_index', [trackIndex]),
      optional('/live/track/get/name', [trackIndex]),
      optional('/live/clip/get/name', [trackIndex, clipIndex]),
    ]);

    const rawPosition = positionReply[0];
    if (typeof rawPosition !== 'number') {
      throw new Error('Ableton sent a position we could not read');
    }
    const isWarped = warpingReply.length > 0 ? isTruthyArg(warpingReply[0]) : undefined;
    const tempo = typeof tempoReply[0] === 'number' && tempoReply[0] > 0 ? tempoReply[0] : this.tempo;

    return {
      position: Math.max(0, Math.round(clipPositionToMs(rawPosition, isWarped, tempo))),
      isPlaying: slotReply[0] === clipIndex,
      trackName: typeof trackNameReply[0] === 'string' ? trackNameReply[0] : '',
      clipName: typeof clipNameReply[0] === 'string' ? clipNameReply[0] : '',
    };
  }
}

function int(value: number): OscArg {
  return { type: 'integer', value };
}

export const abletonService = new AbletonService();

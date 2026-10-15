import { LogOrigin, MittiSettings, MittiState, TimerPhase, mittiStatePlaceholder } from 'ontime-types';

import { toBuffer as oscToBuffer, fromBuffer, type OscPacketOutput } from 'osc-min';
import * as dgram from 'node:dgram';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';
import { ListenSocket } from '../../utils/listenSocket.js';
import { countdownService } from '../countdown-service/CountdownService.js';

import {
  deriveMittiTimes,
  emptyCueTimes,
  isCueUnderway,
  isSameMittiState,
  parseMittiLabel,
  parseMittiTimecode,
  type MittiCueTimes,
} from './mittiUtils.js';

const defaultMittiSettings: MittiSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 51000,
  listenPort: 51001,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 5000,
  relayHost: null,
  relayPort: null,
};

export { defaultMittiSettings };

/** how often we ping Mitti and re-evaluate whether we are still hearing from it */
const healthInterval = 1000;

/**
 * Tracks the playing cue in Mitti.
 *
 * Unlike QLab, Mitti is not polled: it pushes OSC feedback to whichever address is set
 * in its OSC/UDP Controls tab, so we bind a socket and listen. We only talk back to ask
 * for a full resend when we first hear from it, and to ping for a sign of life.
 */
class MittiService {
  private sendSocket: dgram.Socket | null = null;
  private listenSocket: ListenSocket | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private settings: MittiSettings = { ...defaultMittiSettings };
  private lastFeedbackTime = 0;
  private startedAt = 0;
  private hasReportedSilence = false;
  private hasReportedRelayFailure = false;
  private cue: MittiCueTimes = emptyCueTimes();
  private currentState: MittiState = { ...mittiStatePlaceholder };

  init(settings: MittiSettings) {
    this.settings = { ...settings };

    if (!this.settings.enabled) {
      logger.info(LogOrigin.Rx, 'Mitti: Service disabled');
      this.broadcastState();
      return;
    }

    this.start();
  }

  updateSettings(settings: MittiSettings) {
    const wasEnabled = this.settings.enabled;
    this.settings = { ...settings };

    if (!this.settings.enabled) {
      this.stop();
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

  private start() {
    logger.info(LogOrigin.Rx, `Mitti: Listening for feedback on port ${this.settings.listenPort}`);

    this.cue = emptyCueTimes();
    this.lastFeedbackTime = 0;
    this.currentState = { ...mittiStatePlaceholder, enabled: true };
    this.broadcastState();

    this.sendSocket = dgram.createSocket('udp4');
    this.sendSocket.on('error', (error) => {
      logger.error(LogOrigin.Tx, `Mitti send socket error: ${error.message}`);
    });

    this.listenSocket = new ListenSocket({
      label: 'Mitti',
      port: this.settings.listenPort,
      // pass it on before we look at it: whatever we relay to needs the feedback more than we do,
      // and nothing we do with it should be able to hold it up or stop it
      onMessage: (buf) => {
        this.relay(buf);
        this.handlePacket(buf);
      },
      // ask Mitti to send us everything it knows, so we are not blank until the next cue
      onListening: () => this.sendCommand('resendOSCFeedback'),
    });

    this.startedAt = Date.now();
    this.hasReportedSilence = false;
    this.hasReportedRelayFailure = false;

    this.healthTimer = setInterval(() => this.checkHealth(), healthInterval);
  }

  private stop() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    if (this.sendSocket) {
      try {
        this.sendSocket.close();
      } catch {
        // ignore close errors
      }
      this.sendSocket = null;
    }

    if (this.listenSocket) {
      this.listenSocket.close();
      this.listenSocket = null;
    }

    this.cue = emptyCueTimes();
    this.lastFeedbackTime = 0;
    this.startedAt = 0;
    this.currentState = { ...mittiStatePlaceholder };
    this.broadcastState();

    logger.info(LogOrigin.Rx, 'Mitti: Stopped listening');
  }

  /**
   * Forwards a feedback packet, untouched, to a second listener.
   *
   * Mitti sends its feedback to one destination only, so two applications can only both have it
   * if the first one passes it along. Ontime takes that first slot and hands the bytes straight
   * on, so what the other end receives is what Mitti sent.
   */
  private relay(buf: Buffer) {
    const { relayHost, relayPort } = this.settings;
    if (!relayHost || !relayPort || !this.sendSocket) {
      return;
    }

    this.sendSocket.send(buf, 0, buf.byteLength, relayPort, relayHost, (error) => {
      if (!error) {
        this.hasReportedRelayFailure = false;
        return;
      }
      // say it once: this fires per packet, which is several times a second
      if (!this.hasReportedRelayFailure) {
        this.hasReportedRelayFailure = true;
        logger.error(
          LogOrigin.Tx,
          `Mitti: could not pass the feedback on to ${relayHost}:${relayPort} - ${error.message}`,
        );
      }
    });
  }

  private sendCommand(command: string) {
    if (!this.sendSocket) return;

    const buffer = oscToBuffer({ address: `/mitti/${command}`, args: [] });
    this.sendSocket.send(buffer, 0, buffer.byteLength, this.settings.port, this.settings.host, (error) => {
      if (error) {
        logger.warning(LogOrigin.Tx, `Mitti: Failed to send OSC: ${error.message}`);
      }
    });
  }

  private checkHealth() {
    const wasConnected = this.currentState.connected;
    this.sendCommand('ping');
    this.refreshState();

    // Mitti has never spoken to us: it is almost always the feedback destination, so say so once
    if (
      this.lastFeedbackTime === 0 &&
      !this.hasReportedSilence &&
      Date.now() - this.startedAt > this.settings.timeout
    ) {
      this.hasReportedSilence = true;
      logger.warning(
        LogOrigin.Rx,
        `Mitti: no feedback received. In Mitti, check Settings > OSC/UDP Controls is enabled and Feedback To points at this machine on port ${this.settings.listenPort}.`,
      );
    }

    // Mitti came back: ask for the full picture rather than waiting for the next cue change
    if (!wasConnected && this.currentState.connected) {
      this.sendCommand('resendOSCFeedback');
    }
  }

  private handlePacket(buf: Buffer) {
    let packet: OscPacketOutput;
    try {
      packet = fromBuffer(buf);
    } catch {
      return;
    }

    this.lastFeedbackTime = Date.now();
    this.handleOscPacket(packet);
    this.refreshState();
  }

  private handleOscPacket(packet: OscPacketOutput) {
    if (packet.oscType === 'bundle') {
      packet.elements.forEach((element) => this.handleOscPacket(element));
      return;
    }

    const { address, args } = packet;
    if (typeof address !== 'string' || !address.startsWith('/mitti/')) {
      return;
    }

    const parameter = address.slice('/mitti/'.length);
    const value = args[0]?.value;

    switch (parameter) {
      case 'currentCueName': {
        const cueName = parseMittiLabel(value);
        if (cueName === '') {
          // Mitti has no playing cue: the times it sent belong to a cue that is gone
          this.cue = emptyCueTimes();
        } else {
          this.cue.cueName = cueName;
        }
        break;
      }
      case 'currentCueID':
        this.cue.cueNumber = parseMittiLabel(value);
        break;
      case 'cueTimeLeft':
        this.cue.timeLeft = parseMittiTimecode(value);
        break;
      case 'cueTimeElapsed':
        this.cue.elapsed = parseMittiTimecode(value);
        break;
      case 'currentCueTRT':
        this.cue.trt = parseMittiTimecode(value);
        break;
      case 'togglePlay':
        this.cue.isPlaying = value !== 0;
        break;
      default:
        // everything else (per cue properties, playhead, pong) only tells us Mitti is alive
        break;
    }
  }

  private refreshState() {
    if (!this.settings.enabled) return;

    const connected = this.lastFeedbackTime > 0 && Date.now() - this.lastFeedbackTime < this.settings.timeout;
    // a cue that is merely cued up is reported as if it were the running one, so it does not count
    const isRunning = connected && isCueUnderway(this.cue);
    const { duration, elapsed, remaining } = isRunning
      ? deriveMittiTimes(this.cue)
      : { duration: 0, elapsed: 0, remaining: 0 };

    const nextState: MittiState = {
      enabled: true,
      connected,
      cueName: isRunning ? this.cue.cueName : '',
      cueNumber: isRunning ? this.cue.cueNumber : '',
      duration,
      elapsed,
      remaining,
      isPaused: isRunning && !this.cue.isPlaying,
      phase: this.getPhase(duration, remaining),
    };

    if (isSameMittiState(this.currentState, nextState)) {
      return;
    }

    if (this.currentState.connected && !connected) {
      logger.warning(LogOrigin.Rx, 'Mitti: No feedback received, check Mitti OSC feedback settings');
    }

    this.currentState = nextState;
    this.broadcastState();
  }

  private getPhase(duration: number, remaining: number): TimerPhase {
    // nothing is playing, so there is no phase to be in
    if (duration <= 0) return TimerPhase.None;
    if (remaining <= 0) return TimerPhase.Overtime;
    if (remaining <= this.settings.dangerThreshold) return TimerPhase.Danger;
    if (remaining <= this.settings.warningThreshold) return TimerPhase.Warning;
    return TimerPhase.Default;
  }

  private broadcastState() {
    eventStore.set('mitti', this.currentState);
    countdownService.update('mitti', this.currentState);
  }

  getState(): MittiState {
    return { ...this.currentState };
  }
}

export const mittiService = new MittiService();

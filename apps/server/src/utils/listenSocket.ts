import { LogOrigin } from 'ontime-types';

import * as dgram from 'node:dgram';

import { logger } from '../classes/Logger.js';

/** how long to wait before trying a port that was taken again */
const defaultRetryDelay = 5000;

type ListenSocketOptions = {
  /** how the integration names itself in the log, eg 'QLab' */
  label: string;
  port: number;
  onMessage: (buf: Buffer) => void;
  /** called every time the port is successfully bound, retries included */
  onListening?: () => void;
  /** only set by tests, which should not wait the real retry out */
  retryDelay?: number;
};

/**
 * A UDP socket an integration listens on, which keeps trying if the port is taken.
 *
 * Both playback integrations listen on the same ports that Bitfocus Companion's modules use, so
 * on a machine running Companion as well the port is often already held. Going quiet there looks
 * exactly like a device that is switched off, so we say what happened and keep retrying: the
 * integration picks up on its own once whatever held the port lets go of it.
 */
export class ListenSocket {
  private socket: dgram.Socket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private isClosed = false;
  private hasReportedPortInUse = false;

  constructor(private readonly options: ListenSocketOptions) {
    this.open();
  }

  private open() {
    if (this.isClosed) {
      return;
    }

    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    socket.on('message', (buf) => this.options.onMessage(buf));
    socket.on('error', (error) => this.handleError(error as NodeJS.ErrnoException));

    try {
      socket.bind(this.options.port, () => {
        this.hasReportedPortInUse = false;
        logger.info(LogOrigin.Rx, `${this.options.label}: listening on port ${this.options.port}`);
        this.options.onListening?.();
      });
    } catch (error) {
      this.handleError(error as NodeJS.ErrnoException);
    }
  }

  private handleError(error: NodeJS.ErrnoException) {
    if (error.code === 'EADDRINUSE') {
      // only say it once per outage, the retry would otherwise fill the log
      if (!this.hasReportedPortInUse) {
        this.hasReportedPortInUse = true;
        logger.error(
          LogOrigin.Rx,
          `${this.options.label}: port ${this.options.port} is already in use. Bitfocus Companion listens on this port for the same device, so close it or give one of the two a different port. Retrying.`,
        );
      }
      this.scheduleRetry();
      return;
    }

    logger.error(LogOrigin.Rx, `${this.options.label} receive socket error: ${error.message}`);
  }

  private scheduleRetry() {
    this.closeSocket();

    if (this.isClosed || this.retryTimer) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, this.options.retryDelay ?? defaultRetryDelay);
  }

  private closeSocket() {
    if (!this.socket) {
      return;
    }
    try {
      this.socket.close();
    } catch {
      // the socket may never have bound, there is nothing to do about it
    }
    this.socket = null;
  }

  close() {
    this.isClosed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeSocket();
  }
}

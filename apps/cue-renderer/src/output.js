/**
 * One Syphon output: an Ontime view rendered off-screen, published as a Syphon source.
 *
 * Each output keeps two off-screen pages: the Ontime view, and a status card of our own. Whatever
 * Syphon clients receive is one or the other, so a cue screen never shows a blank or half-loaded
 * page: while the view is loading, failing or being restarted, the card says so instead.
 */
const { BrowserWindow } = require('electron');
const path = require('path');

const { getViewUrl } = require('./config.js');
const { evaluate, getRetryDelay, shouldShowView } = require('./health.js');

let syphon = null;
let syphonError = null;
try {
  syphon = require('node-syphon');
} catch (error) {
  syphonError = error.message;
  console.error(`Syphon unavailable, outputs will render but not publish: ${syphonError}`);
}

const overlayMessages = {
  stale: 'NO UPDATES FROM ONTIME — TIMER MAY BE WRONG',
  offline: 'NOT CONNECTED TO ONTIME',
};

function makeFacts(now) {
  return {
    phase: 'loading',
    phaseSince: now,
    lastPaintAt: 0,
    lastHeartbeatAt: 0,
    socketOpen: false,
    socketChangedAt: now,
    lastMessageAt: 0,
    rootEmpty: true,
    lastKickAt: 0,
  };
}

class Output {
  /**
   * @param {number} index
   * @param {() => void} onChange - called whenever the snapshot may have changed
   */
  constructor(index, onChange) {
    this.index = index;
    this.onChange = onChange;
    this.settings = null;
    this.serverUrl = null;
    this.server = null;
    this.view = null;
    this.card = null;
    this.timers = [];
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.facts = makeFacts(Date.now());
    this.status = 'disabled';
    this.overlay = null;
    this.lastError = null;
    this.framesThisSecond = 0;
    this.frameRate = 0;
  }

  /** Applies settings, rebuilding the output only if something about it changed */
  apply(serverUrl, settings) {
    const next = JSON.stringify({ serverUrl, settings });
    if (next === this.applied) return;
    this.applied = next;

    this.teardown();
    this.serverUrl = serverUrl;
    this.settings = settings;

    if (!settings.enabled) {
      this.setStatus('disabled');
      return;
    }

    this.setup();
  }

  setup() {
    const { name, width, height, frameRate, transparent } = this.settings;

    if (syphon) {
      try {
        this.server = new syphon.SyphonMetalServer(name);
      } catch (error) {
        this.lastError = `Could not start Syphon: ${error.message}`;
      }
    } else {
      this.lastError = `Syphon unavailable: ${syphonError}`;
    }

    const windowOptions = (extra) => ({
      show: false,
      width,
      height,
      frame: false,
      transparent,
      backgroundColor: transparent ? '#00000000' : '#000000',
      webPreferences: {
        offscreen: { useSharedTexture: true },
        backgroundThrottling: false,
        ...extra,
      },
    });

    this.card = new BrowserWindow(windowOptions({}));
    this.card.webContents.setFrameRate(Math.min(frameRate, 10));
    this.card.webContents.on('paint', (event) => this.onPaint(event, 'card'));
    this.card.webContents.on('did-finish-load', () => {
      this.cardText = null;
      this.setStatus(this.status);
    });
    this.card.loadFile(path.join(__dirname, 'status.html'));

    this.view = new BrowserWindow(
      windowOptions({
        preload: path.join(__dirname, 'preload-view.js'),
        sandbox: true,
        contextIsolation: true,
        // each output gets its own storage so they show up as separate clients in Ontime
        partition: `persist:output-${this.index + 1}`,
        additionalArguments: [`--ontime-client-name=${name}`],
      }),
    );
    const contents = this.view.webContents;
    contents.setFrameRate(frameRate);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('paint', (event) => this.onPaint(event, 'view'));
    contents.on('did-finish-load', () => this.onLoaded());
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 is an aborted load, which is us starting another one
      if (isMainFrame && errorCode !== -3) this.onFailed('failed', errorDescription);
    });
    contents.on('render-process-gone', (_event, details) =>
      this.onFailed('crashed', `View stopped (${details.reason})`),
    );
    contents.on('unresponsive', () => contents.forcefullyCrashRenderer());

    this.timers.push(setInterval(() => this.tick(), 1000));
    this.load();
  }

  teardown() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;

    for (const window of [this.view, this.card]) {
      if (window && !window.isDestroyed()) window.destroy();
    }
    this.view = null;
    this.card = null;

    if (this.server) {
      this.server.dispose();
      this.server = null;
    }
    this.lastError = null;
    this.overlay = null;
    this.cardText = null;
    this.frameRate = 0;
  }

  /** The page the view is showing, for the settings window */
  get url() {
    return this.settings && this.serverUrl ? getViewUrl(this.serverUrl, this.settings) : null;
  }

  load() {
    if (!this.view) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.facts = makeFacts(Date.now());
    this.overlay = null;
    this.setStatus('loading');
    this.view.webContents.loadURL(this.url).catch(() => {
      // reported through did-fail-load
    });
  }

  /** Reloads the view, eg after an operator asks for it */
  reload() {
    this.retryAttempt = 0;
    this.load();
  }

  onLoaded() {
    const now = Date.now();
    this.facts.phase = 'loaded';
    this.facts.phaseSince = now;
    this.facts.socketChangedAt = now;
    this.lastError = null;
    this.tick();
  }

  onFailed(phase, message) {
    if (!this.view) return;
    this.facts.phase = phase;
    this.facts.phaseSince = Date.now();
    this.lastError = message;
    this.setStatus('fault');

    clearTimeout(this.retryTimer);
    const delay = getRetryDelay(this.retryAttempt);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => this.load(), delay);
  }

  /** Called with what the page reports every second */
  onHeartbeat(report) {
    const now = Date.now();
    const facts = this.facts;
    facts.lastHeartbeatAt = now;
    facts.rootEmpty = Boolean(report.rootEmpty);
    facts.lastMessageAt = Number(report.lastMessageAt) || 0;
    const socketOpen = Boolean(report.socketOpen);
    if (socketOpen !== facts.socketOpen) {
      facts.socketOpen = socketOpen;
      facts.socketChangedAt = now;
    }
  }

  tick() {
    if (!this.view) return;
    const now = Date.now();
    const { status, overlay, action } = evaluate(this.facts, now);
    if (this.facts.phase === 'loaded' || this.facts.phase === 'loading') {
      this.setStatus(status);
    }
    if (status === 'live') this.retryAttempt = 0;

    const overlayMessage = overlay ? overlayMessages[status] : null;
    if (overlayMessage !== this.overlay) {
      this.overlay = overlayMessage;
      this.view.webContents.send('view:command', 'overlay', overlayMessage);
    }

    if (action === 'kick-socket') {
      this.facts.lastKickAt = now;
      this.view.webContents.send('view:command', 'kick-socket');
    } else if (action === 'reload') {
      this.load();
    } else if (action === 'restart') {
      this.lastError = 'View stopped responding';
      this.view.webContents.forcefullyCrashRenderer();
    }

    this.frameRate = this.framesThisSecond;
    this.framesThisSecond = 0;
  }

  setStatus(status) {
    const changed = status !== this.status;
    this.status = status;

    if (this.card && !this.card.isDestroyed()) {
      const text = JSON.stringify([...this.getCardText(), this.url ?? '']);
      if (text !== this.cardText) {
        this.cardText = text;
        this.card.webContents.executeJavaScript(`setStatus(...${text})`).catch(() => {
          // the card is still loading: forget what we sent so the next status tries again
          this.cardText = null;
        });
      }
      // a source that is switched to sends its next frame within a second: both pages pulse a pixel
      // because an invalidate() on an unchanged page paints without a texture
    }

    if (changed) this.onChange();
  }

  getCardText() {
    if (this.status === 'fault') {
      if (this.facts.phase === 'failed') return ["Can't reach Ontime", `${this.lastError ?? 'Load failed'} — retrying`];
      return ['Restarting the view', this.lastError ?? ''];
    }
    // a retry after a failure: keep saying why, rather than flicking back to a hopeful message
    if (this.status === 'loading' && this.retryAttempt > 0 && this.lastError) {
      return ["Can't reach Ontime", `${this.lastError} — retrying`];
    }
    return ['Connecting to Ontime', ''];
  }

  onPaint(event, source) {
    const texture = event.texture;
    if (source === 'view') this.facts.lastPaintAt = Date.now();

    try {
      const wanted = shouldShowView(this.status) ? 'view' : 'card';
      if (texture && this.server && source === wanted) {
        const { codedSize, handle } = texture.textureInfo;
        const region = { x: 0, y: 0, width: codedSize.width, height: codedSize.height };
        // Chromium's surfaces are top-down and Syphon clients read bottom-up, so publish them flipped
        this.server.publishSurfaceHandle(handle.ioSurface, region, codedSize, true);
        this.framesThisSecond += 1;
      }
    } catch (error) {
      this.lastError = `Syphon publish failed: ${error.message}`;
    } finally {
      // textures come from a small pool, so they must go back even when we don't use them
      texture?.release();
    }
  }

  ownsContents(webContents) {
    return Boolean(this.view && !this.view.isDestroyed() && this.view.webContents === webContents);
  }

  getSnapshot() {
    return {
      index: this.index,
      enabled: Boolean(this.settings?.enabled),
      name: this.settings?.name ?? '',
      url: this.url,
      status: this.status,
      lastError: this.lastError,
      frameRate: this.frameRate,
      hasClients: Boolean(this.server?.hasClients),
    };
  }

  /** A small picture of what the view is drawing, for the settings window */
  async capturePreview() {
    if (!this.view || this.view.isDestroyed()) return null;
    const source = shouldShowView(this.status) ? this.view : this.card;
    try {
      const image = await source.webContents.capturePage();
      return image.resize({ width: 320 }).toDataURL();
    } catch {
      return null;
    }
  }
}

module.exports = { Output };

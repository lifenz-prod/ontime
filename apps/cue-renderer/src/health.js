/**
 * Decides, from what an output has observed, what it should show and whether it needs a nudge.
 * Pure so the thresholds can be tested without Electron.
 *
 * The page reports a heartbeat every second with its socket state; the main process records paints
 * and load events. From those we tell apart:
 * - live: Ontime is talking to the page
 * - stale: the page is up but Ontime has gone quiet, so the timer on screen may be wrong
 * - offline: the page has no socket to Ontime at all
 * - fault: the page itself is not usable (failed to load, crashed, hung or blank)
 */

const thresholds = {
  /** Silence after which the timer on screen can no longer be trusted. Ontime sends at least every second */
  staleAfter: 4000,
  /** Silence on an open socket after which we assume it is half-open and close it so the page reconnects */
  kickSocketAfter: 10000,
  /** Without a socket for this long, reload the page in case the app got wedged */
  reloadOfflineAfter: 30000,
  /** Loaded but nothing rendered in the app root for this long means the bundle did not come up */
  blankAfter: 8000,
  /** No heartbeat and no paint for this long means the page's renderer is hung */
  hungAfter: 6000,
  /** A load that has not finished in this long is abandoned and retried */
  loadTimeout: 15000,
};

/** Delay before retry number `attempt` (starting at 0) of a failed load */
function getRetryDelay(attempt) {
  const steps = [1000, 2000, 5000, 10000];
  return steps[Math.min(attempt, steps.length - 1)];
}

/**
 * @param {object} state
 * @param {'loading' | 'loaded' | 'failed' | 'crashed'} state.phase
 * @param {number} state.phaseSince - when the phase was entered
 * @param {number} state.lastPaintAt
 * @param {number} state.lastHeartbeatAt - last report from the page, 0 if none since load
 * @param {boolean} state.socketOpen
 * @param {number} state.socketChangedAt - when socketOpen last changed (or the page loaded)
 * @param {number} state.lastMessageAt - last message from Ontime, 0 if none since load
 * @param {boolean} state.rootEmpty - the app root has rendered nothing
 * @param {number} state.lastKickAt - when we last closed the socket to force a reconnect
 * @param {number} now
 * @returns {{ status: 'loading' | 'live' | 'stale' | 'offline' | 'fault', overlay: boolean, action: 'none' | 'kick-socket' | 'reload' | 'restart' }}
 */
function evaluate(state, now) {
  if (state.phase === 'failed' || state.phase === 'crashed') {
    // the output retries these on its own schedule
    return { status: 'fault', overlay: false, action: 'none' };
  }

  if (state.phase === 'loading') {
    if (now - state.phaseSince > thresholds.loadTimeout) {
      return { status: 'fault', overlay: false, action: 'reload' };
    }
    return { status: 'loading', overlay: false, action: 'none' };
  }

  const sinceLoad = now - state.phaseSince;
  const lastSign = Math.max(state.lastHeartbeatAt, state.lastPaintAt, state.phaseSince);
  if (now - lastSign > thresholds.hungAfter) {
    return { status: 'fault', overlay: false, action: 'restart' };
  }

  if (state.rootEmpty && sinceLoad > thresholds.blankAfter) {
    return { status: 'fault', overlay: false, action: 'reload' };
  }

  if (state.rootEmpty) {
    return { status: 'loading', overlay: false, action: 'none' };
  }

  if (!state.socketOpen) {
    if (now - state.socketChangedAt > thresholds.reloadOfflineAfter) {
      return { status: 'offline', overlay: true, action: 'reload' };
    }
    return { status: 'offline', overlay: true, action: 'none' };
  }

  const silence = now - Math.max(state.lastMessageAt, state.socketChangedAt);
  if (silence > thresholds.kickSocketAfter && now - state.lastKickAt > thresholds.kickSocketAfter) {
    return { status: 'stale', overlay: true, action: 'kick-socket' };
  }
  if (silence > thresholds.staleAfter) {
    return { status: 'stale', overlay: true, action: 'none' };
  }

  return { status: 'live', overlay: false, action: 'none' };
}

/** Whether the output should publish its view rather than its status card */
function shouldShowView(status) {
  return status === 'live' || status === 'stale' || status === 'offline';
}

module.exports = { thresholds, getRetryDelay, evaluate, shouldShowView };

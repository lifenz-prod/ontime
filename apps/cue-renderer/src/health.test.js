import { describe, expect, it } from 'vitest';

import { evaluate, getRetryDelay, shouldShowView, thresholds } from './health.js';

const loadedAt = 100_000;

/** A page that loaded at `loadedAt`, has a socket open and has just heard from Ontime */
function healthyAt(now, overrides = {}) {
  return {
    phase: 'loaded',
    phaseSince: loadedAt,
    lastPaintAt: now,
    lastHeartbeatAt: now,
    socketOpen: true,
    socketChangedAt: loadedAt,
    lastMessageAt: now,
    rootEmpty: false,
    lastKickAt: 0,
    ...overrides,
  };
}

describe('evaluate()', () => {
  it('is live while Ontime is talking', () => {
    const now = loadedAt + 60_000;
    expect(evaluate(healthyAt(now), now)).toEqual({ status: 'live', overlay: false, action: 'none' });
  });

  it('warns once Ontime goes quiet', () => {
    const now = loadedAt + 60_000;
    const state = healthyAt(now, { lastMessageAt: now - thresholds.staleAfter - 1 });
    expect(evaluate(state, now)).toEqual({ status: 'stale', overlay: true, action: 'none' });
  });

  it('closes a socket that has been silent too long, but not again straight away', () => {
    const now = loadedAt + 60_000;
    const silent = healthyAt(now, { lastMessageAt: now - thresholds.kickSocketAfter - 1 });
    expect(evaluate(silent, now).action).toBe('kick-socket');

    const justKicked = { ...silent, lastKickAt: now - 1000 };
    expect(evaluate(justKicked, now)).toEqual({ status: 'stale', overlay: true, action: 'none' });
  });

  it('gives a fresh socket time to hear from Ontime', () => {
    const now = loadedAt + 60_000;
    const state = healthyAt(now, { lastMessageAt: 0, socketChangedAt: now - 1000 });
    expect(evaluate(state, now).status).toBe('live');
  });

  it('shows offline without a socket, and reloads if that lasts', () => {
    const now = loadedAt + 60_000;
    const offline = healthyAt(now, { socketOpen: false, socketChangedAt: now - 5000 });
    expect(evaluate(offline, now)).toEqual({ status: 'offline', overlay: true, action: 'none' });

    const longOffline = { ...offline, socketChangedAt: now - thresholds.reloadOfflineAfter - 1 };
    expect(evaluate(longOffline, now)).toEqual({ status: 'offline', overlay: true, action: 'reload' });
  });

  it('reloads a page that loaded but never drew anything', () => {
    const early = loadedAt + 1000;
    expect(evaluate(healthyAt(early, { rootEmpty: true }), early).status).toBe('loading');

    const late = loadedAt + thresholds.blankAfter + 1;
    expect(evaluate(healthyAt(late, { rootEmpty: true }), late)).toEqual({
      status: 'fault',
      overlay: false,
      action: 'reload',
    });
  });

  it('restarts a page that stopped reporting and drawing', () => {
    const now = loadedAt + 60_000;
    const hungSince = now - thresholds.hungAfter - 1;
    const state = healthyAt(now, { lastHeartbeatAt: hungSince, lastPaintAt: hungSince });
    expect(evaluate(state, now)).toEqual({ status: 'fault', overlay: false, action: 'restart' });
  });

  it('does not call a page hung just because it loaded a moment ago', () => {
    const now = loadedAt + 1000;
    const state = healthyAt(now, { lastHeartbeatAt: 0, lastPaintAt: 0, rootEmpty: true });
    expect(evaluate(state, now).action).toBe('none');
  });

  it('gives up on a load that takes too long', () => {
    const state = { ...healthyAt(0), phase: 'loading', phaseSince: loadedAt };
    expect(evaluate(state, loadedAt + 1000)).toEqual({ status: 'loading', overlay: false, action: 'none' });
    expect(evaluate(state, loadedAt + thresholds.loadTimeout + 1).action).toBe('reload');
  });

  it('leaves failed and crashed pages to their retry', () => {
    for (const phase of ['failed', 'crashed']) {
      const state = { ...healthyAt(0), phase, phaseSince: loadedAt };
      expect(evaluate(state, loadedAt + 60_000)).toEqual({ status: 'fault', overlay: false, action: 'none' });
    }
  });
});

describe('getRetryDelay()', () => {
  it('backs off and then holds', () => {
    expect([0, 1, 2, 3, 4, 20].map(getRetryDelay)).toEqual([1000, 2000, 5000, 10000, 10000, 10000]);
  });
});

describe('shouldShowView()', () => {
  it('shows the view whenever the page is up, and the status card otherwise', () => {
    expect(['live', 'stale', 'offline'].every(shouldShowView)).toBe(true);
    expect(['loading', 'fault', 'disabled'].some(shouldShowView)).toBe(false);
  });
});

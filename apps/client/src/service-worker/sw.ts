/**
 * Offline-fallback service worker
 *
 * The goal is narrow: if a view is reloaded while the network is unavailable
 * (ie: ProPresenter reloading its embedded browser during a hiccup)
 * we serve the last known app shell, assets and data so the view renders
 * and its WebSocket reconnects as normal.
 *
 * - network first everywhere, the cache is only a fallback
 * - live data comes over the WebSocket, which the worker never sees
 * - this file is built to /sw.js by the serviceWorkerPlugin in vite.config.js
 */

import {
  classifyRequest,
  getCacheName,
  isCacheable,
  isStaleCache,
  navigationTimeoutMs,
  resourceTimeoutMs,
} from './swRules';

// injected at build time by the vite plugin
declare const __ONTIME_SW_VERSION__: string;
declare const __ONTIME_SW_PRECACHE__: string[];

/**
 * Minimal typings for the worker globals
 * we avoid lib.webworker since it conflicts with lib.dom in the client tsconfig
 */
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface WorkerScope {
  registration: { scope: string };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const worker = self as unknown as WorkerScope;
const cacheName = getCacheName(__ONTIME_SW_VERSION__);
const scope = worker.registration.scope;
const shellUrl = new URL('index.html', scope).toString();

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      // precaching is best effort: a failure here must never prevent the worker from installing
      const shell = fetch(scope, { cache: 'no-cache', credentials: 'same-origin' }).then((response) =>
        isCacheable(response) ? cache.put(shellUrl, response) : undefined,
      );
      const assets = __ONTIME_SW_PRECACHE__.map((path) => {
        const url = new URL(path, scope).toString();
        return fetch(url, { credentials: 'same-origin' }).then((response) =>
          isCacheable(response) ? cache.put(url, response) : undefined,
        );
      });
      await Promise.allSettled([shell, ...assets]);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => isStaleCache(name, cacheName)).map((name) => caches.delete(name)));
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = classifyRequest(request, scope);

  if (strategy === 'bypass') {
    // not calling respondWith leaves the request to the browser as if there was no worker
    return;
  }

  if (strategy === 'navigation') {
    // every SPA route resolves to the same index.html, so we keep a single shell
    event.respondWith(networkFirst(event, shellUrl, navigationTimeoutMs));
    return;
  }

  event.respondWith(networkFirst(event, request.url, resourceTimeoutMs));
});

/**
 * Race the network against a timeout
 * - network answers (with any status): use it, updating the cache if it was a success
 * - network fails, or is slower than the timeout: use the cache if we have it
 * - nothing cached: wait for the network and let it succeed or fail on its own
 */
async function networkFirst(event: FetchEvent, cacheKey: string, timeoutMs: number): Promise<Response> {
  const { request } = event;
  const network = fetch(request);

  // keep the cache up to date even if we answered from it in the meantime
  event.waitUntil(
    network
      .then(async (response) => {
        if (isCacheable(response)) {
          // clone synchronously, before the page has a chance to consume the body
          const copy = response.clone();
          const cache = await caches.open(cacheName);
          await cache.put(cacheKey, copy);
        }
      })
      .catch(() => undefined),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    const result = await Promise.race([network, timeout]);
    if (result !== 'timeout') {
      return result;
    }
  } catch (_error) {
    // network error, fall through to the cache
  } finally {
    clearTimeout(timer);
  }

  const cached = await caches.match(cacheKey);
  if (cached) {
    return cached;
  }

  return network;
}

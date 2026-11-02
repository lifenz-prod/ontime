/**
 * Pure rules for the offline-fallback service worker
 * Kept free of worker globals so they can be unit tested
 */

export type RequestStrategy = 'navigation' | 'static' | 'data' | 'bypass';

export const cachePrefix = 'ontime-offline-';

/** how long a page load waits for the server before falling back to the cached app shell */
export const navigationTimeoutMs = 3000;
/** how long a script, style or data request waits for the server before falling back to cache */
export const resourceTimeoutMs = 5000;

/**
 * Data endpoints (relative to /data) which must never be served stale
 * - db: project file downloads and the project list
 * - sheets: Google OAuth flow
 * - excel: reads the file currently being imported
 * - session: the root lists live clients
 */
const dataDenylist = ['db', 'sheets', 'excel'];
const dataExactDenylist = ['session'];

/** Routes the client app never owns, a navigation here is not the SPA */
const nonAppSegments = new Set(['data', 'api', 'login', 'external', 'user', 'ws']);

/**
 * Names the cache for a given version of Ontime
 * the version is part of the name so that old caches can be removed when a new worker activates
 */
export function getCacheName(version: string): string {
  return `${cachePrefix}${version}`;
}

/**
 * Whether a cache belongs to this worker but to a different version of Ontime
 */
export function isStaleCache(cacheName: string, currentCacheName: string): boolean {
  return cacheName.startsWith(cachePrefix) && cacheName !== currentCacheName;
}

type RequestLike = {
  method: string;
  url: string;
  mode: string;
  headers?: { has(name: string): boolean };
};

/**
 * Decides how the worker should handle a request
 * @param request - the intercepted request
 * @param scope - the worker scope, ie: http://localhost:4001/ or https://cloud.getontime.no/client-hash/
 */
export function classifyRequest(request: RequestLike, scope: string): RequestStrategy {
  if (request.method !== 'GET') {
    return 'bypass';
  }

  // partial content is not something we can sensibly replay from cache
  if (request.headers?.has('range')) {
    return 'bypass';
  }

  let url: URL;
  let scopeUrl: URL;
  try {
    url = new URL(request.url);
    scopeUrl = new URL(scope);
  } catch (_error) {
    return 'bypass';
  }

  // never handle cross-origin requests, or anything that is not plain http(s)
  if (url.origin !== scopeUrl.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return 'bypass';
  }

  // requests outside the scope (ie: another client in ontime cloud) are not ours
  if (!url.pathname.startsWith(scopeUrl.pathname)) {
    return 'bypass';
  }

  const segments = url.pathname.slice(scopeUrl.pathname.length).split('/').filter(Boolean);
  const [first, second] = segments;

  if (first === 'data') {
    if (!second || dataDenylist.includes(second)) {
      return 'bypass';
    }
    if (segments.length === 2 && dataExactDenylist.includes(second)) {
      return 'bypass';
    }
    return 'data';
  }

  // integrations API: these GET requests trigger actions, the login flow and the websocket are left alone
  if (first === 'api' || first === 'login' || first === 'ws') {
    return 'bypass';
  }

  // the worker script must always come from the network
  if (segments.length === 1 && first === 'sw.js') {
    return 'bypass';
  }

  if (request.mode === 'navigate') {
    // custom external views and user files are real documents, not the SPA shell
    if (first && nonAppSegments.has(first)) {
      return 'static';
    }
    return 'navigation';
  }

  return 'static';
}

type ResponseLike = {
  ok: boolean;
  type: string;
  redirected: boolean;
  headers: { get(name: string): string | null };
};

/**
 * Only successful, same-origin, non-redirected responses are kept
 * this prevents us from caching the login page after an auth redirect, or an error page
 */
export function isCacheable(response: ResponseLike): boolean {
  if (!response.ok || response.type !== 'basic' || response.redirected) {
    return false;
  }
  const cacheControl = response.headers.get('cache-control') ?? '';
  return !cacheControl.includes('no-store');
}

/**
 * Filters the build output into the list of files worth precaching
 * the worker itself, the html shell (cached separately), source maps and pre-compressed variants are excluded
 */
export function getPrecacheList(fileNames: string[]): string[] {
  return fileNames
    .filter((fileName) => {
      if (fileName === 'sw.js' || fileName === 'index.html') return false;
      if (/\.(map|br|gz)$/.test(fileName)) return false;
      return true;
    })
    .sort();
}

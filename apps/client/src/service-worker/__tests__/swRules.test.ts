import { classifyRequest, getCacheName, getPrecacheList, isCacheable, isStaleCache } from '../swRules';

const scope = 'http://localhost:4001/';

function makeRequest(path: string, options: { method?: string; mode?: string; origin?: string; range?: boolean } = {}) {
  const { method = 'GET', mode = 'cors', origin = 'http://localhost:4001', range = false } = options;
  return {
    method,
    mode,
    url: `${origin}${path}`,
    headers: { has: (name: string) => range && name === 'range' },
  };
}

describe('classifyRequest()', () => {
  it('handles navigations to any SPA route with the app shell', () => {
    expect(classifyRequest(makeRequest('/timer', { mode: 'navigate' }), scope)).toBe('navigation');
    expect(classifyRequest(makeRequest('/cuesheet?locked=true', { mode: 'navigate' }), scope)).toBe('navigation');
    expect(classifyRequest(makeRequest('/', { mode: 'navigate' }), scope)).toBe('navigation');
  });

  it('caches build assets as static files', () => {
    expect(classifyRequest(makeRequest('/assets/index-abc123.js'), scope)).toBe('static');
    expect(classifyRequest(makeRequest('/assets/open-sans.woff2'), scope)).toBe('static');
    expect(classifyRequest(makeRequest('/user/styles/override.css'), scope)).toBe('static');
  });

  it('does not treat user files and external views as the SPA shell', () => {
    expect(classifyRequest(makeRequest('/external/my-view/', { mode: 'navigate' }), scope)).toBe('static');
    expect(classifyRequest(makeRequest('/user/logo/logo.png', { mode: 'navigate' }), scope)).toBe('static');
  });

  it('caches data the views load on startup', () => {
    expect(classifyRequest(makeRequest('/data/rundown/normalised'), scope)).toBe('data');
    expect(classifyRequest(makeRequest('/data/view-settings'), scope)).toBe('data');
    expect(classifyRequest(makeRequest('/data/custom-fields'), scope)).toBe('data');
    expect(classifyRequest(makeRequest('/data/session/info'), scope)).toBe('data');
  });

  it('never handles data which must not be stale', () => {
    expect(classifyRequest(makeRequest('/data'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/db'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/db/all'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/db/download/project.json'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/sheets/connect'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/excel/worksheets'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/session'), scope)).toBe('bypass');
  });

  it('never handles integrations, login, the websocket or the worker itself', () => {
    expect(classifyRequest(makeRequest('/api/start'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/login', { mode: 'navigate' }), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/ws'), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/sw.js'), scope)).toBe('bypass');
  });

  it('never handles mutations', () => {
    expect(classifyRequest(makeRequest('/data/rundown', { method: 'POST' }), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/rundown/1', { method: 'PATCH' }), scope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/data/rundown', { method: 'DELETE' }), scope)).toBe('bypass');
  });

  it('never handles cross-origin or range requests', () => {
    expect(classifyRequest(makeRequest('/timer', { origin: 'http://localhost:5173', mode: 'navigate' }), scope)).toBe(
      'bypass',
    );
    expect(classifyRequest(makeRequest('/repos/cpvalente/ontime', { origin: 'https://api.github.com' }), scope)).toBe(
      'bypass',
    );
    expect(classifyRequest(makeRequest('/user/video.mp4', { range: true }), scope)).toBe('bypass');
  });

  it('resolves paths relative to a prefixed scope', () => {
    const cloudScope = 'https://cloud.getontime.no/client-hash/';
    const origin = 'https://cloud.getontime.no';
    expect(classifyRequest(makeRequest('/client-hash/timer', { origin, mode: 'navigate' }), cloudScope)).toBe(
      'navigation',
    );
    expect(classifyRequest(makeRequest('/client-hash/data/rundown/normalised', { origin }), cloudScope)).toBe('data');
    expect(classifyRequest(makeRequest('/client-hash/data/db', { origin }), cloudScope)).toBe('bypass');
    expect(classifyRequest(makeRequest('/other-hash/timer', { origin, mode: 'navigate' }), cloudScope)).toBe('bypass');
  });
});

describe('isCacheable()', () => {
  function makeResponse(overrides: Partial<{ ok: boolean; type: string; redirected: boolean; cacheControl: string }>) {
    const { ok = true, type = 'basic', redirected = false, cacheControl = null } = overrides;
    return { ok, type, redirected, headers: { get: () => cacheControl } };
  }

  it('accepts successful same-origin responses', () => {
    expect(isCacheable(makeResponse({}))).toBe(true);
    expect(isCacheable(makeResponse({ cacheControl: 'public, max-age=0' }))).toBe(true);
  });

  it('rejects errors, redirects, opaque responses and no-store', () => {
    expect(isCacheable(makeResponse({ ok: false }))).toBe(false);
    expect(isCacheable(makeResponse({ redirected: true }))).toBe(false);
    expect(isCacheable(makeResponse({ type: 'opaqueredirect' }))).toBe(false);
    expect(isCacheable(makeResponse({ type: 'opaque' }))).toBe(false);
    expect(isCacheable(makeResponse({ cacheControl: 'no-store' }))).toBe(false);
  });
});

describe('cache versioning', () => {
  it('only marks other ontime caches as stale', () => {
    const current = getCacheName('4.0.2-abc');
    expect(isStaleCache(getCacheName('4.0.1-def'), current)).toBe(true);
    expect(isStaleCache(current, current)).toBe(false);
    expect(isStaleCache('some-other-cache', current)).toBe(false);
  });
});

describe('getPrecacheList()', () => {
  it('keeps build assets and drops the worker, shell, maps and compressed files', () => {
    const files = [
      'index.html',
      'sw.js',
      'sw.js.map',
      'assets/vendor-123.js',
      'assets/vendor-123.js.map',
      'assets/vendor-123.js.br',
      'assets/index-456.css',
      'assets/open-sans.woff2',
    ];
    expect(getPrecacheList(files)).toEqual(['assets/index-456.css', 'assets/open-sans.woff2', 'assets/vendor-123.js']);
  });
});

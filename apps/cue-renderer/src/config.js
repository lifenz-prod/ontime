/**
 * Renderer configuration: which Ontime server to follow and what each Syphon output shows.
 * Everything here is pure so it can be tested without Electron.
 */

/** Ontime views worth putting on a cue screen, in the order the settings window lists them */
const knownViews = [
  { path: 'cuescreen', label: 'Cuescreen' },
  { path: 'cuescreennow', label: 'Cuescreen NOW/NEXT' },
  { path: 'qlabcountdown', label: 'Playback Countdown' },
  { path: 'qlab', label: 'QLab' },
  { path: 'timer', label: 'Timer' },
  { path: 'minimal', label: 'Minimal Timer' },
  { path: 'clock', label: 'Wall Clock' },
  { path: 'countdown', label: 'Countdown' },
  { path: 'backstage', label: 'Backstage' },
  { path: 'studio', label: 'Studio Clock' },
];

const outputCount = 2;

const limits = {
  width: { min: 320, max: 7680 },
  height: { min: 180, max: 4320 },
  frameRate: { min: 1, max: 60 },
};

function makeDefaultOutput(index) {
  return {
    enabled: index === 0,
    name: `Ontime Cue ${index + 1}`,
    view: index === 0 ? 'cuescreen' : 'cuescreennow',
    query: '',
    width: 1920,
    height: 1080,
    frameRate: 30,
    transparent: false,
  };
}

function makeDefaultConfig() {
  return {
    serverUrl: 'http://localhost:4001',
    outputs: Array.from({ length: outputCount }, (_, index) => makeDefaultOutput(index)),
  };
}

function clampInteger(value, { min, max }, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Accepts `192.168.1.10:4001`, `http://host:4001/`, `http://host:4001/editor` ...
 * and returns the origin, or null if it can't be made into an http(s) URL
 */
function normaliseServerUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Strips slashes and anything after the path so the view is a bare route, eg `cuescreen` */
function normaliseView(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const view = value
    .trim()
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, '');
  return view || fallback;
}

function normaliseQuery(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\?+/, '');
}

function normaliseOutput(raw, index) {
  const fallback = makeDefaultOutput(index);
  const output = raw && typeof raw === 'object' ? raw : {};
  const name = typeof output.name === 'string' && output.name.trim() ? output.name.trim() : fallback.name;

  return {
    enabled: typeof output.enabled === 'boolean' ? output.enabled : fallback.enabled,
    name,
    view: normaliseView(output.view, fallback.view),
    query: normaliseQuery(output.query),
    width: clampInteger(output.width, limits.width, fallback.width),
    height: clampInteger(output.height, limits.height, fallback.height),
    frameRate: clampInteger(output.frameRate, limits.frameRate, fallback.frameRate),
    transparent: typeof output.transparent === 'boolean' ? output.transparent : fallback.transparent,
  };
}

/** Turns whatever was on disk (or sent from the settings window) into a complete, valid config */
function normaliseConfig(raw) {
  const defaults = makeDefaultConfig();
  const config = raw && typeof raw === 'object' ? raw : {};
  const outputs = Array.isArray(config.outputs) ? config.outputs : [];

  const normalised = {
    serverUrl: normaliseServerUrl(config.serverUrl) ?? defaults.serverUrl,
    outputs: defaults.outputs.map((_, index) => normaliseOutput(outputs[index], index)),
  };

  // Syphon clients pick sources by name, so two outputs must never share one
  if (normalised.outputs[0].name === normalised.outputs[1].name) {
    normalised.outputs[1].name = `${normalised.outputs[1].name} (2)`;
  }

  return normalised;
}

/** The page an output loads */
function getViewUrl(serverUrl, output) {
  const url = new URL(`/${output.view}`, serverUrl);
  if (output.query) {
    url.search = output.query;
  }
  return url.toString();
}

module.exports = {
  knownViews,
  outputCount,
  limits,
  makeDefaultConfig,
  normaliseConfig,
  normaliseServerUrl,
  getViewUrl,
};

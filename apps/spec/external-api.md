# Ontime API reference (for external consumers)

How another application reads live timing and event data out of an Ontime server, and
optionally drives playback. Everything here is served by the Node server in `apps/server`,
whether it is running standalone, inside Electron, or in Docker.

> **Version: Ontime v4.0.3-beta.4** (`lifenz-prod/ontime`, branch `beta-releases` — the
> line releases are cut from). Checked against the source on 2026-11-11.
>
> If you are talking to a build from the `feature/pco-connector` branch instead, see
> §11 — `rundownSources` has a different shape there and there is an extra `/data/pco`
> router.

---

## 1. At a glance

| I want to… | Use |
|---|---|
| Follow the running timer, current/next event, clock, messages | **WebSocket** `/ws` — push, ~1 Hz |
| **Show the video countdown (QLab / Mitti / Ableton / timecode)** | **WebSocket** `countdown` key — see §5 |
| Read the whole rundown (all events, times, custom fields) | **REST** `GET /data/rundown/normalised` |
| Read project title, custom field definitions, settings | **REST** `GET /data/project`, `/data/custom-fields`, `/data/settings` |
| One-off snapshot of live state without a socket | **REST** `GET /api/poll` |
| Start/stop/load events, add time, set messages | **REST** `GET /api/<action>` or the same actions over WebSocket / OSC |
| Feed Ontime LTC timecode from your own reader | **WebSocket** `timecode-frame` — see §5.4 |
| Have Ontime push to *you* on lifecycle events | **Automations** (HTTP/OSC out, configured in Ontime) |

The golden rule: **WebSocket for state, REST for structure.** The socket never sends the
rundown; the REST rundown never tells you what is playing. You need both.

---

## 2. Things worth flagging for the consuming app

Read this before you write any code against Ontime. Each of these has bitten an integrator.

1. **`clock` and every `time*` field are milliseconds since local midnight, not epoch.**
   `13:30:00` is `48600000`. Mixing these with `Date.now()` fails silently and produces
   1970-era nonsense. The only epoch values in the whole API are
   `RecentSheet.lastUsed` / `LoadedSheet.importedAt`.
2. **Ontime calculates at ~32 ms but broadcasts at 1 Hz.** `ontime-clock` and
   `ontime-timer` arrive roughly once a second (`updateRate: 32`,
   `notificationRate: 1000`). For a smooth display, interpolate locally between messages
   and re-sync on each one. Do not expect sub-second pushes.
3. **`MaybeNumber` nulls are not zeros.** `timer.current === null` means nothing is
   loaded, not "zero remaining". Guard every read.
4. **`timer.current` goes negative in overtime.** Render negatives as `+MM:SS`.
5. **`runtime.offset` is positive when *early*, negative when *late*.** Getting this
   backwards is the classic integration bug.
6. **Milliseconds in the store, seconds in the control API.** `addtime`, `globaldelay`
   and `auxtimer` all take seconds.
7. **Buffer socket deltas until `ontime-flush`,** or you will render a torn frame where
   `clock` has advanced but `timer` has not.
8. **The rundown only arrives over REST.** Nothing but `ontime-refetch` tells you it
   changed — and you must compare `revision` before re-fetching, because refetch signals
   arrive in bursts during an edit.
9. **Re-fetch everything on reconnect, and treat the `ontime` snapshot as authoritative**
   (replace, do not merge). Refetch signals sent while you were disconnected are not
   replayed.
10. **`start`/`load` by `index` are 1-based**, while `runtime.selectedEventIndex` is
    0-based.
11. **`skip: true` events sit in the rundown but never play** — filter them out of
    "what's next" logic yourself. `numEvents` counts every `type: 'event'` entry,
    skipped ones included.
12. **Times can exceed `86400000`** on shows crossing midnight. Use `dayOffset` and take
    `% 86400000` to render a wall clock.
13. **Ignore unknown message types and unknown object keys.** The protocol grows; both
    ends already ignore what they do not recognise.

---

## 3. Connecting

### Base URL

Default `http://<host>:4001`. The port is user-configurable (Settings → server port, also
returned by `GET /data/session/info`). Ontime binds all interfaces, so any machine on the
LAN can reach it.

Ontime Cloud serves under a path prefix (`https://cloud.getontime.com/<client-hash>/…`).
If you support that, treat the prefix as part of your base URL and prepend it to every path
below, including `/ws`.

### Route namespaces

| Prefix | Purpose |
|---|---|
| `/ws` | WebSocket endpoint |
| `/api/*` | Integration API — runtime control + `poll`, `version` |
| `/data/*` | Application data (rundown, project, settings, integrations) |
| `/external/*`, `/user/*` | Static user assets |

CORS is open (`cors()` on all routes, pre-flight enabled), so a browser app on another
origin can call these directly.

### Authentication

Auth is **off unless the operator sets a password**. When one is set, `/api/*`, `/data/*`,
the static client and the WebSocket all require a token:

- REST: `?token=<hashedPassword>` on the query string, or a `token` cookie.
- WebSocket: same — `?token=…` on the socket URL, or the cookie.

An unauthorised REST call returns `401 Unauthorized`; an unauthorised socket is closed with
code `1008`. The token value is the server's hashed password — an operator can generate a
ready-made authenticated URL via `POST /data/session/url`.

Design for both: make the token optional in your config, and append it when present.

---

## 4. WebSocket — live state

```
ws://<host>:4001/ws          (wss:// when the page/server is TLS)
```

Max payload 256 KB. No subprotocol. There is no subscribe step — you receive everything.

### Message envelope

Every message in both directions is JSON:

```json
{ "type": "<string>", "payload": <any> }
```

Unknown `type` values are ignored by both ends, so new message types are non-breaking.

### What you receive

**On connect**, in order:

1. `client` — `{ clientId, clientName }`, your identity on this server.
2. `client-list` — every connected client, keyed by id.
3. `ontime` — **the full runtime store snapshot** (see §6). This is your initial state.

**Then, continuously**, per-key deltas. Whenever a store key changes, the server emits

```json
{ "type": "ontime-<key>", "payload": <new value of that key> }
```

followed once per batch by

```json
{ "type": "ontime-flush" }
```

Several keys can change in one tick; they arrive as separate `ontime-<key>` messages and
then a single `ontime-flush`. **Buffer the keys and apply them on flush** — that is what
Ontime's own client does.

The full set of `ontime-<key>` messages:

| Message | Payload type |
|---|---|
| `ontime-clock` | `number` |
| `ontime-timer` | `TimerState` |
| `ontime-onAir` | `boolean` |
| `ontime-message` | `MessageState` |
| `ontime-runtime` | `Runtime` |
| `ontime-currentBlock` | `CurrentBlockState` |
| `ontime-eventNow` | `OntimeEvent \| null` |
| `ontime-eventNext` | `OntimeEvent \| null` |
| `ontime-publicEventNow` | `OntimeEvent \| null` |
| `ontime-publicEventNext` | `OntimeEvent \| null` |
| `ontime-auxtimer1` | `SimpleTimerState` |
| **`ontime-countdown`** | **`CountdownState` — the video countdown, §5** |
| `ontime-qlab` | `QlabState` |
| `ontime-mitti` | `MittiState` |
| `ontime-ableton` | `AbletonState` |
| `ontime-timecode` | `TimecodeState` |
| `ontime-rundownSources` | `RundownSourcesState` |
| `ontime-flush` | — (apply buffered keys) |

Plus these non-store messages:

| Message | Meaning |
|---|---|
| `ontime` | Full store snapshot (on connect, or on a server broadcast) |
| `ontime-refetch` | **REST data is stale — re-fetch.** See below |
| `ontime-log` | A server log line (`Log`) |
| `client`, `client-list`, `client-name`, `client-rename`, `client-redirect` | Client bookkeeping |
| `dialog` | UI hint for the Ontime client; ignore |
| `pong` | Reply to your `ping` |

### `ontime-refetch` — the rundown invalidation signal

This is the piece integrators most often miss. The rundown is **not** pushed over the
socket. When it changes, you get:

```json
{ "type": "ontime-refetch",
  "payload": { "target": "RUNDOWN", "revision": 42, "changes": ["id1","id2"], "reload": false } }
```

- `target: "RUNDOWN"` → re-fetch `GET /data/rundown/normalised` if `revision` is greater
  than the `revision` you last stored. Custom field definitions may have changed too.
- `target: "REPORT"` → re-fetch `GET /data/report`.
- `reload: true` → a whole new project was loaded; invalidate **everything** you cached.

`changes` lists the touched entry ids when the edit was scoped; treat it as a hint, not a
guarantee (it is `undefined` for structural edits).

### What you can send

You do not have to send anything. Optional:

| Send | Effect |
|---|---|
| `{"type":"ping","payload":<ISO date>}` | Server echoes `{"type":"pong","payload":<same>}`. Round-trip ÷ 2 = your latency estimate |
| `{"type":"set-client-name","payload":"Stage Display"}` | Name yourself in Ontime's client list |
| `{"type":"set-client-type","payload":"ontime"}` | Declare a client type |
| `{"type":"set-client-path","payload":"/my-app"}` | Declare what you are showing |
| `{"type":"set-client-patch","payload":{...}}` | Set several of the above at once |
| `{"type":"get-client-name"}` | Ask for your assigned name |
| `{"type":"timecode-frame","payload":TimecodeFrame}` | Feed Ontime a decoded LTC frame (§5.4) |
| `{"type":"timecode-reader","payload":TimecodeReaderStatus}` | Report your reader's health (§5.4) |
| `{"type":"ontime-log","payload":{level,origin,text}}` | Write into Ontime's log |
| Any **control action** from §8 | Same dispatcher as `/api/*`; a reply comes back as `{type:<same>, payload:…}` |

Being a good citizen: send `set-client-patch` with a recognisable name on open, so the
operator can see your app in Ontime's network panel.

### Reconnection

The socket closes when the server restarts or the network drops. Reconnect on a timer
(Ontime's own client retries every 1 s), replace your state from the `ontime` snapshot, and
re-fetch the rundown.

---

## 5. The video countdown

**This is the one to use if your app shows "time left on the video".**

Ontime watches up to four playback systems and resolves them into **one** store key,
`countdown`, so a consumer never has to know which system is feeding it. Ontime's own
"Video Countdown" view (`/qlabcountdown`) reads nothing but this key.

```ts
type CountdownSource   = 'qlab' | 'mitti';                          // operator-selectable
type CountdownProvider = CountdownSource | 'ableton' | 'timecode';  // + automatic takeover

type CountdownSourceState = {
  enabled: boolean;     // the integration is switched on in settings
  connected: boolean;   // Ontime is actually hearing from it
  cueName: string;      // the playing cue / clip / timer name
  cueNumber: string;    // QLab cue number; '' for the others
  duration: number;     // ms, total length
  elapsed: number;      // ms, played so far
  remaining: number;    // ms — THE NUMBER YOU DISPLAY
  isPaused: boolean;
  phase: TimerPhase;    // 'none'|'default'|'warning'|'danger'|'overtime'
};

// what you receive on `ontime-countdown`
type CountdownState = CountdownSourceState & { source: CountdownProvider };
```

### 5.1 How the source is chosen

- **QLab and Mitti are selected by the operator**, via `viewSettings.countdownSource`
  (`GET`/`POST /data/view-settings`). Exactly one of them feeds the countdown at a time.
  On POST, `countdownSource` is optional — omitting it leaves the current source alone —
  but every *other* view-settings field is required, so read the object first and post it
  back whole or you will get a `422`.
- **Ableton and timecode are not selected — they take over by themselves** while one of
  their timers is running, and hand back the moment it finishes. Ableton wins if both are
  running.

"Running" means `enabled && connected && duration > 0 && remaining > 0`.

So `countdown.source` can change underneath you mid-show. **Always read `source` alongside
the numbers** if you label the countdown; never cache which provider is on screen.

### 5.2 Displaying it

`remaining` is milliseconds. Ontime's own view renders `m:ss` with no hour component
(90 minutes shows as `90:00`) and keeps the sign for negatives:

```ts
function formatCountdown(ms: number | null): string {
  if (ms === null) return '0:00';
  const total = ms < 0 ? Math.ceil(Math.abs(ms) / 1000) : Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${ms < 0 ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}
```

Colour off `phase` — Ontime has already applied the provider's warning/danger thresholds.

Check `enabled` and `connected` before showing anything: a disabled or disconnected
provider publishes a zeroed state, which would otherwise read as a genuine `0:00`.

### 5.3 The per-provider keys

Each provider also publishes its own raw state, if you want one specific system rather than
"whatever is on screen":

| Store key | Type | Notes |
|---|---|---|
| `qlab` | `QlabState` | = `CountdownSourceState` |
| `mitti` | `MittiState` | = `CountdownSourceState` |
| `ableton` | `AbletonState` | = `CountdownSourceState` |
| `timecode` | `TimecodeState` | `CountdownSourceState` **plus** the extra fields below |

```ts
type TimecodeState = CountdownSourceState & {
  signal: boolean;          // frames are arriving
  current: number | null;   // latest timecode, ms since 00:00:00:00
  fps: number | null;       // 24, 25 or 30 (30 = 29.97 DF)
  dropFrame: boolean;
  reader: (TimecodeReaderStatus & { connected: boolean }) | null;
};
```

Settings for each live at `GET`/`POST /data/qlab`, `/data/mitti`, `/data/ableton`,
`/data/timecode` — host, ports, `warningThreshold`, `dangerThreshold`, `timeout`, and for
Ableton/timecode the list of configured timers.

One Mitti note: Mitti only feeds a single destination, so `MittiSettings.relays` lets
Ontime pass the feedback on to other listeners (in practice Companion). If your app needs
Mitti's raw feedback as well as Ontime's, ask the operator to add you as a relay.

### 5.4 Feeding Ontime timecode from your app

Ontime can read LTC itself on macOS desktop, but everywhere else (CLI, Docker) it relies on
a **reader client** sending frames over the WebSocket. Any app can be that reader:

```json
{ "type": "timecode-frame",
  "payload": { "hours": 10, "minutes": 32, "seconds": 7, "frames": 12,
               "dropFrame": false, "fps": 25 } }
```

Send one message per decoded frame. Ontime carries the last frame forward on its own clock
between messages, and declares the signal lost after `TimecodeSettings.timeout` ms
(default 500). Frames are ignored unless the timecode integration is enabled in settings.

About once a second, also report how you are getting on:

```json
{ "type": "timecode-reader",
  "payload": { "devices": ["Scarlett 2i2"], "deviceLabel": "Scarlett 2i2", "channel": 1,
               "level": 0.42, "error": "", "deviceChannels": [2] } }
```

`level` is the peak on the timecode channel over the last second (0–1), `error` explains
why you are not reading if you are not, and `deviceChannels` is optional. This surfaces in
Ontime's settings UI so the operator can see your reader. Ontime marks the reader
disconnected if no status arrives within its reader timeout.

`GET /data/timecode/current` returns `{ current, fps, signal }` — the timecode to the
frame, right now, for "set to current timecode" style UI.

---

## 6. The runtime store — data model

This is the object you get in the `ontime` snapshot, from `GET /api/poll`, and piecemeal via
`ontime-<key>`.

```ts
type RuntimeStore = {
  clock: number;                       // ms since local midnight
  timer: TimerState;
  onAir: boolean;                      // true whenever playback !== 'stop'

  message: MessageState;

  runtime: Runtime;
  currentBlock: CurrentBlockState;
  eventNow: OntimeEvent | null;
  eventNext: OntimeEvent | null;
  publicEventNow: OntimeEvent | null;  // nearest event with isPublic: true
  publicEventNext: OntimeEvent | null;

  auxtimer1: SimpleTimerState;

  countdown: CountdownState;           // the resolved video countdown — §5
  qlab: QlabState;
  mitti: MittiState;
  ableton: AbletonState;
  timecode: TimecodeState;

  rundownSources: RundownSourcesState; // recallable rundowns (Google Sheets)

  ping: number;                        // client-side only; server sends -1, ignore it
};
```

### `clock`

**Milliseconds since local midnight**, from the server's system clock — *not* a Unix
timestamp. Values can exceed `86400000` (`dayInMs`) when a schedule runs past midnight.

### `timer: TimerState`

```ts
type TimerState = {
  addedTime: number;          // ms added/removed by the operator, can be negative
  current: MaybeNumber;       // ms remaining — COUNTS DOWN, goes NEGATIVE in overtime
  duration: MaybeNumber;      // ms, normalised duration of the loaded event
  elapsed: MaybeNumber;       // ms, === duration - current
  expectedFinish: MaybeNumber;// time of day (ms since midnight) the timer should end
  finishedAt: MaybeNumber;    // time of day it actually finished, null until then
  phase: 'none'|'default'|'warning'|'danger'|'overtime'|'pending';
  playback: 'roll'|'play'|'pause'|'stop'|'armed';
  secondaryTimer: MaybeNumber;// roll mode only: ms until the next event starts
  startedAt: MaybeNumber;     // time of day it started, null until then
};
```

`MaybeNumber = number | null`.

- `current` is the number most displays want.
- `phase` is the display-state machine, already computed from the event's `timeWarning` /
  `timeDanger`. Colour off `phase`, not your own arithmetic. `pending` means roll mode is
  waiting for the next event's start time.
- `playback: 'armed'` means an event is loaded but not started.
- In **count-to-end** events (`countToEnd: true`, the fork's "Countdown to Time"), `current`
  is derived from the event's end time-of-day rather than from a duration.

### `runtime: Runtime` — where the show is against schedule

```ts
type Runtime = {
  numEvents: number;            // count of entries of type 'event' (skipped ones included)
  selectedEventIndex: MaybeNumber; // 0-based index of the loaded event
  globalDelay: number;          // ms of operator-applied delay at the current event
  offset: number;               // ms — SIGN MATTERS, see below
  relativeOffset: number;       // ms, offset measured from actualStart instead of the clock
  plannedStart: MaybeNumber;    // time of day the rundown was scheduled to start
  actualStart: MaybeNumber;     // time of day it actually started, null before
  plannedEnd: MaybeNumber;      // time of day, may exceed dayInMs
  expectedEnd: MaybeNumber;     // plannedEnd adjusted by offset, may exceed dayInMs
  offsetMode: 'absolute' | 'relative';
};
```

**`offset` sign convention:** positive = **ahead of schedule**, negative = **behind /
running late**. It is built from `scheduledStart − actualStart − addedTime − pausedTime +
overtime`, so every way of losing time pushes it negative.

`expectedEnd` is the field to show a producer: "at the current rate, we finish at X".

### `message: MessageState`

```ts
type MessageState = {
  timer: {
    text: string;              // operator's message to the timer views
    visible: boolean;
    blink: boolean;
    blackout: boolean;         // hide the timer entirely
    secondarySource: 'aux' | 'external' | null;
  };
  external: string;            // "Stage Message" in this fork — a second free-text channel
};
```

If you render a timer face, honour `visible`, `blackout` and `blink` — operators rely on
them mid-show.

### `currentBlock`, `auxtimer1`

```ts
type CurrentBlockState = {
  block: OntimeBlock | null;   // the section header the playhead is inside
  startedAt: MaybeNumber;
};

type SimpleTimerState = {      // an independent stopwatch, unrelated to the rundown
  duration: number; current: number;
  playback: 'start' | 'pause' | 'stop';
  direction: 'count-up' | 'count-down';
};
```

### `rundownSources: RundownSourcesState`

Rundowns that can be recalled from the linked Google Sheet's worksheet tabs.

```ts
type RundownSourcesState = {
  provider: 'gsheet' | null;
  containerId: string | null;   // the Google Sheet ID
  sources: { index: number; name: string }[];   // index is 1-based, used for recall
  loaded: string | null;        // name of the source last loaded
  loading: boolean;
  error: string | null;
  revision: number;             // increments on every successful list refresh
};
```

---

## 7. REST — rundown and structure

All under `/data`. Responses are JSON.

### `GET /data/rundown/normalised` → `RundownCached`

The one you want. Normalised so ids are stable and order is explicit.

```ts
type RundownCached = {
  rundown: Record<string, OntimeRundownEntry>;  // id → entry
  order: string[];                              // ids in running order
  revision: number;                             // compare against ontime-refetch
};
```

Operator-applied delays are already folded into each event's `delay` field in this
response.

**Entry shapes** — discriminate on `type`:

```ts
type OntimeEvent = {
  type: 'event';
  id: string;
  cue: string;              // the operator-facing cue number, e.g. "3.1"
  title: string;
  note: string;
  timerType: 'count-down' | 'count-up' | 'clock' | 'none';
  endAction: 'load-next' | 'none' | 'play-next' | 'play-next-delayed' | 'stop';
  countToEnd: boolean;      // "Countdown to Time" — end-anchored event
  showAsAuxTimer: boolean;
  hideTimer: boolean;
  linkStart: string | null; // id of the event this one is chained to
  timeStrategy: 'lock-end' | 'lock-duration';
  timeStart: number;        // time of day, ms since midnight
  timeEnd: number;          // time of day, ms since midnight
  duration: number;         // ms
  isPublic: boolean;        // drives publicEventNow/Next and public views
  skip: boolean;            // excluded from playback
  colour: string;
  revision: number;
  delay: number;            // ms, computed — cumulative delay reaching this event
  dayOffset: number;        // whole days past the first, for schedules over midnight
  gap: number;              // ms of idle time before this event
  timeWarning: number;      // ms remaining at which phase becomes 'warning'
  timeDanger: number;       // ms remaining at which phase becomes 'danger'
  custom: Record<string, string>;   // custom fields, keyed by label
  triggers?: Trigger[];
  generatedFor?: string;    // fork: ServiceProfile id, on generated 11am entries
  mirrorOf?: string;        // fork: id of the 9am master entry this was cloned from
  deviated?: boolean;       // fork: hand-edited generated entry, not re-cloned
};

type OntimeBlock = { type: 'block'; id: string; title: string; /* + fork fields */ };
type OntimeDelay = { type: 'delay'; id: string; duration: number; /* + fork fields */ };
```

**Computing a real start time:** `timeStart + delay` gives the effective time of day, and
`dayOffset * 86400000` accounts for rolling past midnight. `timeStart` alone is the
*authored* time and will be wrong once delays are in play.

### Other rundown reads

| Endpoint | Returns |
|---|---|
| `GET /data/rundown` | The rundown as a flat ordered array |
| `GET /data/rundown/paginated?offset=&limit=` | Page of the same |
| `GET /data/rundown/:eventId` | One entry |

Write endpoints exist (`POST/PUT/PATCH/DELETE /data/rundown/…`) but are outside the scope of
a read-only consumer; prefer the `/api/change` action in §8 for small live edits.

### Supporting data

| Endpoint | Returns |
|---|---|
| `GET /data/project` | `{ title, description, publicUrl, publicInfo, backstageUrl, backstageInfo, projectLogo }` |
| `GET /data/custom-fields` | `Record<label, { type: 'string'\|'image', colour, label }>` — the *definitions*; values live on each event's `custom` |
| `GET /data/settings` | `{ app, version, serverPort, editorKey, operatorKey, timeFormat: '12'\|'24', language, endActionDelay }` |
| `GET /data/view-settings` | `{ countdownSource, dangerColor, endMessage, freezeEnd, normalColor, overrideStyles, warningColor }` |
| `GET /data/session/info` | `{ networkInterfaces, version, serverPort, publicDir }` |
| `GET /data/session` | `{ startedAt, connectedClients, lastConnection, lastRequest, projectName, playback, timezone }` |
| `GET /data/report` | Per-event actual start/end report |
| `GET /data/qlab` · `/data/mitti` · `/data/ableton` · `/data/timecode` | Settings for each countdown provider (§5) |
| `GET /data/timecode/current` | `{ current, fps, signal }` — live timecode to the frame |
| `GET /data/sheets/recent` · `/data/sheets/loaded` | Recently used Google Sheets / the tab the rundown came from |
| `GET /data/service-profiles` | **Fork:** `{ boundaryBlockId, services: [{ id, name, offset }] }` |

`timeFormat` and `timezone` are worth reading once at startup so your display matches the
operator's.

---

## 8. Control API (optional)

Same action set over three transports, all handled by one dispatcher:

- **HTTP:** `GET /api/<action>/<path…>?<query>` → `202` with `{ payload: … }`
- **WebSocket:** `{"type":"<action>","payload":{…}}` → reply `{type, payload}`
- **OSC:** `/ontime/<action>/<params…> <args>` on the configured OSC-in port

HTTP path segments become a nested payload object: `/api/message/timer/text?value=Hello`
is equivalent to a payload of `{ timer: { text: 'Hello' } }`. On error you get `500` with
`{ message }`.

| Action | Payload | Notes |
|---|---|---|
| `version` | — | Server version string |
| `poll` | — | **Full runtime store** — the REST way to snapshot live state |
| `start` | `undefined` \| `'next'` \| `'previous'` \| `{index}` \| `{id}` \| `{cue}` | `index` is **1-based** |
| `load` | same as `start` | Loads without starting |
| `pause`, `stop`, `reload`, `roll` | — | |
| `addtime` | `{add: seconds}` \| `{remove: seconds}` \| `seconds` | **Seconds**, max ±1 h |
| `globaldelay` | `{add}` \| `{remove}` \| `'reset'` | Seconds |
| `message` | `{ timer: {text, visible, blink, blackout, secondarySource}, external }` | Partial patch; returns the new `MessageState` |
| `change` | `{ "<eventId>": { "<field>": value } }` | Live-edit one event; throttled for fields that force a rundown rebuild |
| `auxtimer` | `{ "1": 'start'\|'pause'\|'stop' }` or `{ "1": {duration\|addtime\|direction} }` | Durations in **seconds** |
| `offsetmode` | `'absolute'` \| `'relative'` | |
| `client` | `{target, rename\|redirect\|identify}` | |
| `sources`, `refreshsources`, `loadsource` | — / target | Recallable rundown sources |

There is **no control action for the countdown** — the source is a view setting
(`POST /data/view-settings`), and Ableton/timecode take over on their own.

Examples:

```
GET /api/poll
GET /api/start/next
GET /api/start/cue/3.1
GET /api/addtime?add=30
GET /api/message/timer/text?value=Standby
```

---

## 9. Ontime pushing to you (Automations)

If polling and sockets do not suit — say your app only needs a nudge at cue points — the
operator can configure **Automations** in Ontime: a lifecycle trigger, an optional filter,
and one or more HTTP/OSC outputs.

Triggers: `onLoad`, `onStart`, `onPause`, `onStop`, `onClock`, `onUpdate`, `onFinish`,
`onWarning`, `onDanger`.

Outputs interpolate `{{…}}` template strings against the runtime state:

```
http://my-app.local:8080/cue?title={{eventNow.title}}&cue={{eventNow.cue}}&remaining={{timer.current}}
```

Any store path works (`{{clock}}`, `{{timer.phase}}`, `{{runtime.offset}}`,
`{{countdown.remaining}}`, `{{eventNow.custom.Speaker}}`). Pre-formatted aliases render as
`HH:MM:SS` instead of raw milliseconds: `{{human.clock}}`, `{{human.runningTimer}}`,
`{{human.duration}}`, `{{human.elapsedTime}}`, `{{human.expectedEnd}}`,
`{{human.startedAt}}`, `{{human.qlabTimer}}`, `{{human.qlabDuration}}`,
`{{human.qlabElapsed}}`.

HTTP outputs are fired as plain `GET` requests, fire-and-forget; Ontime logs failures but
does not retry. Use this for events, not for state you must not miss.

---

## 10. Reference client (TypeScript)

```ts
type Store = Record<string, unknown>;

export function connectOntime(host: string, token?: string, onState?: (s: Store) => void) {
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws${qs}`;

  let store: Store = {};
  const pending = new Map<string, unknown>();
  let ws: WebSocket;
  let rundownRevision = -1;

  const fetchRundown = async () => {
    const res = await fetch(`http://${host}/data/rundown/normalised${qs}`);
    const data = await res.json();          // { rundown, order, revision }
    rundownRevision = data.revision;
    return data;
  };

  const connect = () => {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'set-client-patch', payload: { type: 'custom', name: 'My App' } }));
      fetchRundown();                        // the socket never sends the rundown
    };

    ws.onmessage = ({ data }) => {
      const { type, payload } = JSON.parse(data);

      if (type === 'ontime') {               // full snapshot: replace, don't merge
        store = payload;
        onState?.(store);
        return;
      }

      if (type === 'ontime-flush') {         // apply the buffered batch atomically
        if (pending.size) {
          store = { ...store, ...Object.fromEntries(pending) };
          pending.clear();
          onState?.(store);
        }
        return;
      }

      if (type === 'ontime-refetch') {
        if (payload?.reload) { fetchRundown(); /* + invalidate everything else */ }
        else if (payload?.target === 'RUNDOWN' && payload.revision > rundownRevision) fetchRundown();
        return;
      }

      if (type.startsWith('ontime-')) pending.set(type.slice('ontime-'.length), payload);
    };

    ws.onclose = () => setTimeout(connect, 1000);   // reconnect; snapshot re-syncs us
  };

  connect();
  return () => ws?.close();
}
```

Reading the video countdown out of that store:

```ts
const c = store.countdown as CountdownState | undefined;
const showCountdown = Boolean(c?.enabled && c?.connected);
const label = c?.cueName ?? '';
const display = showCountdown ? formatCountdown(c!.remaining) : '--:--';
const feedingSystem = c?.source;   // 'qlab' | 'mitti' | 'ableton' | 'timecode'
```

Formatting the main event timer (hours, `+` for overtime):

```ts
function formatTimer(ms: number | null): string {
  if (ms === null) return '--:--:--';
  const over = ms < 0;
  const t = Math.abs(ms);
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const body = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  return over ? `+${body}` : body;
}

function formatClock(msSinceMidnight: number): string {
  return formatTimer(msSinceMidnight % 86_400_000);
}
```

---

## 11. Fork-specific notes (`lifenz-prod/ontime`)

This deployment runs replica 9am/11am services in a single rundown:

- Entries carry `generatedFor` (the `ServiceProfile` id) on generated instances and
  `mirrorOf` (the id of the 9am master entry they were cloned from). Both are absent on
  rehearsal entries and on the 9am master itself. `deviated: true` marks a generated entry
  that was hand-edited and is therefore kept rather than re-cloned.
- `GET /data/service-profiles` returns `{ boundaryBlockId, services: [{ id, name, offset }] }`.
  The block at `boundaryBlockId` starts the master service; anything before it is rehearsal
  and runs once. `offset` is milliseconds added to master times for that instance (the
  master is `0`).
- To group the rundown into PRE / 9am / 11am, split the `order` array at `boundaryBlockId`
  and then group the remainder by `generatedFor`.
- The 11am section is **re-derived** when the 9am master is edited — never cache generated
  entry ids across an `ontime-refetch`.
- Some labels differ from upstream: "External Message" is **Stage Message**
  (`message.external`), "Count to end" is **Countdown to Time** (`countToEnd`), and the
  `/qlabcountdown` view is presented as **Video Countdown**.

### If you are talking to a `feature/pco-connector` build

That branch is not merged into the release line and differs in two ways that affect this
document:

- **`rundownSources` is multi-provider.** `RundownSource` gains `provider: 'gsheet'|'pco'`
  and `providerIndex`; the state gains `providers: RundownSourceOrigin[]` and
  `loadedProvider`, in place of the single `provider` / `containerId` pair in §6.
- **There is an extra `/data/pco` router** for the Planning Center connector, and PCO types
  live in `packages/types`. On the release line PCO is server-internal
  (`apps/server/src/services/pco-service/pcoTypes.ts`) with no HTTP surface of its own.

That branch does **not** have the countdown work in §5 — no `countdown`, `mitti`, `ableton`
or `timecode` store keys, and `qlab` is the only playback integration.

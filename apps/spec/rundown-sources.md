# Rundown sources

A **rundown source** is a rundown which lives outside the project file and can be recalled into it on
demand. The sources are the worksheet tabs of the linked Google Sheet and the pinned service types of
the Planning Center organisation, so a Companion button can pull up "Rehearsal", "Christmas Eve" or
this Sunday's Central AM run sheet without anyone opening the settings panel.

**Both origins are listed at once.** They are separate providers contributing to one list, and neither
takes anything away from the other: turning Planning Center on does not stop worksheet recall.

The feature has two halves:

- the list of available rundowns is published on the websocket, so an integration can populate a selector
- a recall is triggered through the integration API, on OSC, websocket or HTTP

## The list

The runtime store gained a `rundownSources` key. Like every other store key it is included in the full
`ontime` payload sent on connect, and pushed on its own as `ontime-rundownSources` whenever it changes.

```jsonc
{
  "type": "ontime-rundownSources",
  "payload": {
    "sources": [
      { "index": 1, "providerIndex": 1, "name": "Sunday 9am + 11am", "provider": "gsheet" },
      { "index": 2, "providerIndex": 2, "name": "Rehearsal", "provider": "gsheet" },
      { "index": 3, "providerIndex": 1, "name": "Central AM", "provider": "pco" },
      { "index": 4, "providerIndex": 2, "name": "Central PM", "provider": "pco" },
    ],
    "providers": [
      { "id": "gsheet", "containerId": "1a2b3c...", "count": 2, "error": null },
      { "id": "pco", "containerId": null, "count": 2, "error": null },
    ],
    "loaded": "Central AM", // name of the source last recalled, null before the first recall
    "loadedProvider": "pco", // which origin it came from
    "loading": false, // a refresh or a recall is in flight
    "error": null, // reason the last operation failed, cleared on success
    "revision": 4, // increments on every successful refresh
  },
}
```

Two addresses, and the difference matters when building buttons:

- `index` is the position in the whole list. Sheet tabs come first, so an existing worksheet index still
  points at the same tab.
- `providerIndex` is the position within one provider, and is the **stable** one. Adding a worksheet tab
  shifts every `index` after it but changes nothing inside Planning Center, so a button aimed at one
  provider should use this together with the provider name.

Names are the other option, and for Planning Center they are the better one: a source is named after the
service type, so "Central AM" keeps meaning the next Central AM service and a button built on it does
not expire. Reordering tabs in Google Sheets reshuffles indices, so name those too if the buttons need
to survive it.

A provider that fails to list is recorded against itself in `providers[].error` and skipped — a revoked
Google token does not hide the Planning Center services, or the reverse. The top level `error` is only
set when nothing could be listed at all.

The list is read once at startup and refreshed on demand.

## Commands

Three actions are available on all three transports.

| Action           | Payload                       | Effect                               |
| ---------------- | ----------------------------- | ------------------------------------ |
| `sources`        | none                          | returns the state shown above        |
| `refreshsources` | none                          | re-reads the list from all providers |
| `loadsource`     | index, name, or either scoped | recalls a rundown, see below         |

`loadsource` accepts a 1 based index or a name. Names are matched case insensitively. Numbers sent as
text are treated as an index, since OSC and HTTP frequently carry them that way.

It also accepts a **provider scope**, which is how a button says which origin it means. Scoped, an index
counts within that provider:

- `{ "provider": "pco", "name": "Central AM" }` or `{ "provider": "pco", "index": 1 }`
- `"pco:Central AM"` — a prefix, for transports that can only carry one string
- a provider path segment, `/ontime/loadsource/pco 1`

A name that exists in **both** providers is refused rather than guessed at, since replacing the rundown
from the wrong origin is worse than doing nothing:

```
"Rehearsal" exists in gsheet and pco, say which one: eg. gsheet:Rehearsal
```

### OSC

```
/ontime/loadsource 3                  # by index across the whole list
/ontime/loadsource "Rehearsal"        # by name
/ontime/loadsource/index 3            # equivalent to the first
/ontime/loadsource/pco 1              # first Planning Center source
/ontime/loadsource/pco "Central AM"   # by name, unambiguously
/ontime/loadsource "pco:Central AM"   # same, as one string
/ontime/loadsource/gsheet "Rehearsal"
/ontime/refreshsources
```

### Websocket

```jsonc
{ "type": "loadsource", "payload": 3 }
{ "type": "loadsource", "payload": "Rehearsal" }
{ "type": "loadsource", "payload": { "provider": "pco", "name": "Central AM" } }
{ "type": "loadsource", "payload": { "provider": "pco", "index": 1 } }
{ "type": "sources" }
```

### HTTP

```
GET /api/loadsource/3
GET /api/loadsource?name=Rehearsal
GET /api/loadsource/pco/1
GET /api/loadsource/pco?name=Central%20AM
GET /api/refreshsources
GET /api/sources
```

## What a recall does

1. reads the rundown from the provider it came from, using the column mapping of the last import made
   from the UI when that provider is the sheet
2. replaces the rundown, custom fields and service profiles, exactly as the settings panel import does
3. regenerates the dual-service instances, if the project is configured for them
4. leaves playback stopped with no event loaded, the operator loads what they need

Steps 2 and 3 mean a recall **stops playback and replaces the current rundown**, the same destructive
operation as importing from the settings panel. To keep a stray button press from ending a live service,
a recall is **refused while playback is `play`, `pause` or `roll`**:

```
Refusing to recall a rundown while playback is play, stop playback first
```

`armed` and `stop` are allowed: nothing is running yet, so replacing the rundown interrupts no one.
A recall never starts or arms anything itself — it leaves playback stopped. There is no override: press
STOP first if you really mean to replace a running show.

Refreshing the list is never guarded, it only reads.

Recalls are long running, so the command replies immediately and reports the outcome through the store:
watch `loading`, `error` and `loaded`. Failures are also written to the Ontime log. Only one refresh or
recall runs at a time; a second request while one is in flight is rejected.

## The import map

An import needs to know which spreadsheet column holds which field. The UI carries that mapping in the
browser, which is no use to a recall arriving over OSC, so the server now remembers the map from the
last import or export made through the settings panel and reuses it. Before any import has been made it
falls back to the defaults in `defaultImportMap`.

In practice this means **doing one manual import from the settings panel after changing the column
layout**, so the recall picks up the same mapping.

## The providers

| provider | container        | sources                      | named by              | resolves to               |
| -------- | ---------------- | ---------------------------- | --------------------- | ------------------------- |
| `gsheet` | the linked sheet | its worksheet tabs           | the tab name          | that tab                  |
| `pco`    | the organisation | its **pinned** service types | the service type name | its next plan, from today |

Planning Center is addressed by service type, not by plan. A recall resolves the soonest plan dated
today or later at the moment it runs, so "Central AM" pressed on a Sunday morning loads that morning's
run sheet, and the same button still works next week. Only **pinned** service types are listed — the
organisation this was built for has 329 of them, and the pins are the ones it actually uses, set on the
Planning Center tab in app settings.

Both providers list whenever they can. Planning Center needs a credential pair and the _Offer plans to
Companion and OSC_ switch; the sheet needs an authenticated Google account and a linked sheet. Sheet
tabs are listed first so existing indices do not move. See
`apps/server/src/services/pco-service/README.md`.

A specific dated plan can be imported by hand from that panel, which is the same destructive operation
as a recall and carries the same refusal while a show is running. Recall itself always means "the next
one" — a Companion button holding a date would be dead by Monday.

A plan carries no column mapping, so a PCO recall keeps the project's custom fields and ignores the
import map entirely.

## Adding another origin

`rundownSourceProviders.ts` holds the seam. A provider answers four questions — am I available, what
container am I reading, what is in it, and give me one of them — and the recall API above is unchanged:

```ts
export type RundownSourceProviderApi = {
  id: RundownSourceProvider;
  isAvailable: () => boolean;
  getContainerId: () => MaybeString;
  list: () => Promise<string[]>;
  fetch: (name: string) => Promise<FetchedSource>;
};
```

A provider which does not carry custom fields can omit them from `fetch`, and the ones already in the
project are kept. The first available provider in the array wins.

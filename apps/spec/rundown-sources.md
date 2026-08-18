# Rundown sources

A **rundown source** is a rundown which lives outside the project file and can be recalled into it on
demand. Today the sources are the worksheet tabs of the linked Google Sheet, so a Companion button can
pull up "Rehearsal" or "Christmas Eve" without anyone opening the settings panel.

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
    "provider": "gsheet",         // which origin populated the list, null when nothing is connected
    "containerId": "1a2b3c...",   // the google sheet ID
    "sources": [
      { "index": 1, "name": "Sunday 9am + 11am" },
      { "index": 2, "name": "Rehearsal" },
      { "index": 3, "name": "Christmas Eve" }
    ],
    "loaded": "Rehearsal",        // name of the source last recalled, null before the first recall
    "loading": false,             // a refresh or a recall is in flight
    "error": null,                // reason the last operation failed, cleared on success
    "revision": 4                 // increments on every successful refresh
  }
}
```

`index` is 1 based and follows the tab order in the sheet. It is the address used for recall, so
**reordering tabs in Google Sheets reshuffles the indices** — recall by name if the buttons need to
survive that.

The list is read once at startup and refreshed on demand. It is empty when no source is connected,
with the reason in `error`.

## Commands

Three actions are available on all three transports.

| Action           | Payload                         | Effect                                                 |
| ---------------- | ------------------------------- | ------------------------------------------------------ |
| `sources`        | none                            | returns the state shown above                          |
| `refreshsources` | none                            | re-reads the list from the provider                    |
| `loadsource`     | index, name, `{index}`/`{name}` | recalls a rundown and arms its first event, see below  |

`loadsource` accepts a 1 based index or a name. Names are matched case insensitively. Numbers sent as
text are treated as an index, since OSC and HTTP frequently carry them that way.

### OSC

```
/ontime/loadsource 3                  # by index
/ontime/loadsource "Rehearsal"        # by name
/ontime/loadsource/index 3            # equivalent to the first
/ontime/refreshsources
```

### Websocket

```jsonc
{ "type": "loadsource", "payload": 3 }
{ "type": "loadsource", "payload": "Rehearsal" }
{ "type": "sources" }
```

### HTTP

```
GET /api/loadsource/3
GET /api/loadsource?name=Rehearsal
GET /api/refreshsources
GET /api/sources
```

## What a recall does

1. reads the rundown from the provider, using the column mapping of the last import made from the UI
2. replaces the rundown, custom fields and service profiles, exactly as the settings panel import does
3. regenerates the dual-service instances, if the project is configured for them
4. loads the first event, so the operator only needs to press GO

Steps 2 and 3 mean a recall **stops playback and replaces the current rundown**, the same destructive
operation as importing from the settings panel. To keep a stray button press from ending a live service,
a recall is **refused while playback is `play`, `pause` or `roll`**:

```
Refusing to recall a rundown while playback is play, stop playback first
```

`armed` and `stop` are allowed. `armed` has to be, because a recall leaves playback armed — refusing it
would stop an operator recalling twice in a row. There is no override: press STOP first if you really
mean to replace a running show.

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

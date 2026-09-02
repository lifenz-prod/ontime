# Planning Center connector

Generates an Ontime rundown from a Planning Center Online (PCO) Services plan,
including the PRE section and both Sunday services.

## Status

Feasibility spike. The API client, the rundown builder, and the rules config are
complete and unit tested against a fixture shaped like a real Central AM plan.
Not yet wired to an HTTP route or the settings UI.

## What PCO gives us, and what it does not

| Need                    | PCO source                                        |
| ----------------------- | ------------------------------------------------- |
| Service start times     | `PlanTime.starts_at`, `time_type: 'service'`      |
| Rehearsal times         | `PlanTime.starts_at`, `time_type: 'rehearsal'`    |
| Run sheet order         | `Item.sequence`                                   |
| Segment durations       | `Item.length` (seconds)                           |
| Section dividers        | `Item.item_type: 'header'`                        |
| Per-service differences | `ItemTime.exclude` / `.length` / `.length_offset` |

**Items carry durations, not absolute start times.** Every time is computed from
a `PlanTime.starts_at`. This is why the builder needs a timezone: PCO timestamps
are UTC, and Ontime works in local time of day (9am NZST arrives as `21:00Z` the
previous day).

**`service_position` decides the direction of travel.** This is not a detail:

| position | placement                                                        |
| -------- | ---------------------------------------------------------------- |
| `pre`    | back-times as one contiguous run **ending** at the service start |
| `during` | accumulates **forward** from the service start                   |
| `post`   | continues after the last `during` item                           |

Verified against the 23 August Central AM sheet to the second: briefing 15:00 +
prayer 25:00 + doors 12:20 + online message 1:00 + pre-service video 1:40 =
55:00, and `9:00 - 55:00 = 8:05`, which is the time written into the
_SERVICE BRIEFING 8:05AM_ header title. Accumulating those forward instead would
put doors open at 9:00.

**One item list serves every time in a plan.** PCO does not hold a separate run
sheet per service. That is what makes the 9am/11am relationship a pure time
offset, which is exactly the shape `serviceInstanceUtils.regenerateInstances`
already expects. Where PCO _can_ express a real difference — an item excluded
from one service, or given a different length there — the builder surfaces it as
a warning rather than silently flattening it. See `findDivergence`.

## Output shape

```
[ PRE entries ... ]        run once, never duplicated
[ boundary block "9am" ]   serviceProfiles.boundaryBlockId
[ service entries ... ]    the master section
```

The 11am is **not** written by this connector. It is derived by
`regenerateInstances` from `ServiceProfile.offset`, computed as the gap between
the plan's first and second service times. That keeps "9am is master, 11am is
re-derived" true for imports as well as for hand edits.

## Sectioning

The PRE section runs from the top of the plan up to **and including** the item
matching `preBoundaryTitleMatch` (default `prayer meeting`). The boundary block
goes immediately after it.

`preAnchor` decides where the pre-service run starts:

- `back-from-service` (default) — how PCO itself works, and what the real sheet
  matches: the run back-times to end at the service start.
- `plan-time` — anchors forward from the earliest non-service `PlanTime` on the
  chosen day. Falls back to back-timing when the day has no such time.

## Multi-day plans

A plan often carries a midweek rehearsal alongside the Sunday times. An Ontime
rundown is a single day, so the day is chosen explicitly:
`groupPlanTimesByDay` returns every date the plan touches, and
`buildRundownFromPlan` takes a `targetDate`. With no `targetDate` it picks the
first day that actually holds a service time, so the Wednesday rehearsal is never
mistaken for the service day. Asking for a day with no services is an error, not
a silent empty rundown.

## Rules config

Timer types and the implicit parts of the morning live in
`<ontime data dir>/pco-rules.json`, seeded from `defaultPcoRules` on first read.
`pco-rules.example.json` in this directory is a copy for reference.

- `defaultEffect` — applied to every event. Ships as count-down + `countToEnd`
  (Ontime's "Countdown to Time") + `lock-end`.
- `timerRules` — first match wins, layered over `defaultEffect`. Ships with one
  rule making anything titled _message_ or _sermon_ a fixed-duration countdown.
- `inferredEntries` — entries the run sheet implies but never states, positioned
  by an anchor (`pre-start`, `service-start`, `service-end`) plus a signed
  offset, so they track the plan when times move.
- `ignoreItems` — items that never reach the rundown.

> The single shipped `inferredEntries` value (_Doors Open_, 15 minutes before the
> service) is a **placeholder**. The shape is what has been proven, not the
> content.

## Verifying against a real plan

Credentials are a PCO Personal Access Token: an Application ID + Secret pair
created at <https://api.planningcenteronline.com/oauth/applications> under
_Personal Access Tokens_. They are sent as HTTP Basic and read from the
environment only — nothing is written to disk.

```sh
export PCO_APP_ID=...
export PCO_SECRET=...

cd apps/server
pnpm tsx src/services/pco-service/dev/pcoProbe.ts --service-type "Central AM"
```

The probe lists service types, upcoming plans, plan times grouped by day, and
items, then prints the generated rundown, the service profiles, and the rundown
after the mirror runs. Useful flags:

- `--day 2026-08-23` — build for a specific date
- `--plan 71234567` — a specific plan instead of the next upcoming one
- `--rules ./my-rules.json` — try alternative rules without touching the app
- `--raw pco-raw.json` — dump the API payloads for turning into a test fixture
- `--service-type-id 12345` — skip the name lookup (or set `PCO_SERVICE_TYPE_ID`)

There is also an offline preview that needs no credentials, driven by the
transcribed 23 August sheet:

```sh
pnpm tsx src/services/pco-service/dev/pcoPreview.ts
```

`PcoCredentials` is deliberately the only auth-shaped type in the client, so an
OAuth bearer token can replace the Basic header later without touching the
builder or any calling code.

## Not done yet

- HTTP route + client UI (would sit beside `api-data/sheets` and the
  service-profiles settings panel)
- Applying the generated rundown to the project, rather than printing it
- Honouring `ItemTime` divergence instead of only warning about it
- OAuth 2, if this ever needs to serve more than one organisation

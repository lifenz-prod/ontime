# Planning Center connector

Generates an Ontime rundown from a Planning Center Online (PCO) Services plan,
including the PRE section and both Sunday services.

## Status

Usable. The API client, the rundown builder and the rules config are unit tested
against a fixture shaped like a real Central AM plan. The connector is registered
as a **rundown source provider**, so a plan can be recalled over OSC, websocket or
HTTP, and there is a settings panel for importing by hand and for configuring what
each run sheet item does. Credentials are still environment-only.

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
a `PlanTime.starts_at`. This is why the builder needs a timezone: those timestamps
are UTC, and Ontime works in local time of day (9am NZST arrives as `21:00Z` the
previous day).

**`Plan.sort_date` is the exception, and it lies.** It carries a `Z` and is not a
UTC instant: PCO writes the organisation's local wall clock into it. On the same
Sunday, Central AM's 9am plan reads `2026-08-23T09:00:00Z` while its service time
reads `2026-08-22T21:00:00Z`, and Central PM's 6pm plan reads
`2026-08-23T18:00:00Z`. So `sort_date` is read as written and never converted --
converting it moves every afternoon service to the next day. Only `starts_at` goes
through `pcoTime.ts`.

**`service_position` decides the direction of travel.** This is not a detail:

| position | placement                                                        |
| -------- | ---------------------------------------------------------------- |
| `pre`    | back-times as one contiguous run **ending** at the service start |
| `during` | accumulates **forward** from the service start                   |
| `post`   | continues after the last `during` item                           |

Verified against the live 23 August Central AM plan to the second: prayer 25:00 +
doors 12:20 + online message 1:00 + pre-service video 1:40 = 40:00, and
`9:00 - 40:00 = 8:20`, where the prayer meeting starts. Accumulating those forward
instead would put doors open at 9:00.

**Headers are not necessarily where they look.** The plan opens with a
_SERVICE BRIEFING 8:05AM_ header, and that header is a `during` item carrying no
length — so it would land in the master section rather than at the top of PRE, and
the 8:05 briefing itself is nowhere in the data. Nothing in PCO says when it
happens except those four characters of title text.

So the shipped rules do two things with it: `ignoreItems` drops the header, which
would otherwise be a divider stranded mid-service naming a time already past, and
an `inferredEntries` entry puts the briefing back as a real 15 minute event
anchored to `pre-start`. On the 23 August plan that lands it at 8:05, the time the
header claims. Anchoring rather than hardcoding is the point: the pre run
back-times to the service, so a service that moves takes the briefing with it. The
15 minutes is the only number not derived from the plan — it is the gap between
the title's 8:05 and the 8:20 the lengths add up to.

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

## Recalling a plan

The connector is a provider behind the rundown-source API, the same one that
recalls a worksheet tab from the linked Google Sheet. See
`apps/spec/rundown-sources.md` for the commands; nothing about them is
PCO-specific.

One source per upcoming plan, soonest first, each named by the **date it runs on**:

```
1  2026-08-23
2  2026-08-30
3  2026-09-06
```

```
/ontime/loadsource 1                  # next Sunday's plan
/ontime/loadsource "2026-09-06"       # a specific one
```

The date is read in the configured timezone, not sliced off the timestamp: PCO
stamps a 9am Auckland service `21:00Z` the day before, so the raw date would name
Sunday's plan after Saturday. Two plans on one date are distinguished by plan id,
`2026-08-23 (71234567)`.

A recall builds the rundown, then replaces the project's rundown and service
profiles and regenerates the 11am. It is **refused while playback is running** and
custom fields are left alone, because a plan carries no column mapping. Divergence
between the two service times is written to the log rather than flattened silently.

### Turning it on

Two separate switches, on purpose:

1. `PCO_APP_ID` / `PCO_SECRET` — the ability to read PCO. Read from the environment,
   or from a `.env` in the Ontime **data directory**, next to `pco-rules.json`: an
   installed copy has no shell to export a variable from. A real environment
   variable wins over the file.
2. **Recall plans instead of Google Sheet tabs**, the switch on the settings panel
   (`enabled` in `pco-rules.json`) — the decision to serve `loadsource` from
   Planning Center. A token sitting in the environment does not change what an
   existing Companion button does.

With both set, the provider serves the source list ahead of the sheet. Which
service type it pulls from is `PCO_SERVICE_TYPE_ID`, else `serviceTypeId`, else
`serviceTypeName` (a case-insensitive substring, so `central am` finds
_Central AM Service_), else the first **pinned** service type, else the
organisation's only one. Anything ambiguous is an error listing the ids to choose
from — this organisation has 329 service types, so guessing would be worse than
failing.

## The settings panel

Two entries under _Planning Center_ in app settings, both editing the same
`pco-rules.json`. Every control saves immediately: a dirty form on either would
have to write the whole file back, silently reverting the other.

**Import from Planning Center** — connection state, the switch above, the pinned
service types, and the upcoming plans across them with an Import button per plan.
Pinning exists because of the 329: the picker is a search, and what gets used is
kept. A pin carries an optional campus heading, which groups the plan list.
Importing replaces the rundown and the service profiles, and is refused while a
show is running.

**Import defaults** — the default timing applied to every event, then the items
Planning Center actually carries, read from the next few run sheets of a pinned
service type. Each row offers timing, hide timer, aux timer and skip, and writes a
rule matching that title. Rows for things that cannot be affected — a header that
imports as a block, an item dropped by `ignoreItems` — say so and are disabled
rather than offering a control that would do nothing.

A rule written by the panel matches `titleContains`, a literal case-insensitive
substring, because a run sheet title is not a regex and nobody should have to
escape one. Panel rules are inserted **ahead** of hand-written ones, since first
match wins. Hand-written rules are listed separately, and can be removed there but
not edited.

### What the file holds

Only what differs from the shipped defaults. The file is merged over
`defaultPcoRules`, so persisting the whole object would freeze the defaults at the
version that saved it and no rule shipped later could reach the installation. The
trade-off: choosing a value that happens to equal today's default records nothing,
so a later change to that default carries.

## Rules config

Timer types and the implicit parts of the morning live in
`<ontime data dir>/pco-rules.json`, which is **merged over** `defaultPcoRules` —
so it only needs the keys it wants to change, and anything it leaves out follows
the shipped defaults even as those change between versions. On first use the file
is seeded with just the switch and the service type for that reason.
`pco-rules.example.json` in this directory lists every option with the shipped
values.

- `defaultEffect` — applied to every event. Ships as count-down + `countToEnd`
  (Ontime's "Countdown to Time") + `lock-end`.
- `timerRules` — first match wins, layered over `defaultEffect`. Ships with one
  rule making anything titled _message_ or _sermon_ a fixed-duration countdown.
- `inferredEntries` — entries the run sheet implies but never states, positioned
  by an anchor (`pre-start`, `service-start`, `service-end`) plus a signed
  offset, so they track the plan when times move.
- `ignoreItems` — items that never reach the rundown.

The one shipped `inferredEntries` value is the service briefing described above.
Doors, walk-in and the pre-service video are **not** inferred — they are real
`pre` items on the sheet.

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

- Credentials in the UI. They are environment or `.env` only, so setting them up
  still means touching a file. The panel reports whether they are present, never
  their value.
- Building a plan for a chosen day. `buildRundownFromPlan` takes a `targetDate` and
  reports `availableDays`, and the import route accepts one, but neither the panel
  nor a recall offers the choice yet.
- Editing hand-written pattern rules in the panel, and reordering rules.
- Honouring `ItemTime` divergence instead of only warning about it.
- OAuth 2, if this ever needs to serve more than one organisation.

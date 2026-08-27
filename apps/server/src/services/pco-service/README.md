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

**The plan starts at doors.** Everything earlier — power on, soundcheck, the
briefing, the prayer meeting — belongs to the production team, and PCO records
none of it. The only trace is two headers titled _SERVICE BRIEFING 8:05am_ and
_LINK BRIEF 8:10am_, both `during` items carrying no length, so even those two
would land mid-service naming a time already past.

The whole morning is therefore `inferredEntries`: a contiguous run anchored to
`pre-start`, entered as lengths and chained so the last one hands over to the run
sheet's first item. Anchoring rather than hardcoding is the point — the pre run
back-times to the service, so a service that moves takes the morning with it. On
a 9:00 service with 15:00 of pre-service items that puts doors at 8:45 and power
on at 5:30, and the two times those headers claim fall exactly where they say.

The prayer meeting is on the sheet as a 25:00 `pre` item _and_ in the production
run as two entries (the meeting, then the pack-down), so `ignoreItems` drops the
PCO copy. That is also why the pre-service run starts at doors rather than at
8:20: the run sheet's own `pre` items are just doors and the pre-service video.

**One item list serves every time in a plan.** PCO does not hold a separate run
sheet per service. That is what makes the 9am/11am relationship a pure time
offset, which is exactly the shape `serviceInstanceUtils.regenerateInstances`
already expects. Where PCO _can_ express a real difference — an item excluded
from one service, or given a different length there — the builder surfaces it as
a warning rather than silently flattening it. See `findDivergence`.

Two things are deliberately left out of that report: PRE, which runs once and is
never mirrored, and items merged into the entry above them. The plan shape that
makes merging useful is the one where PCO holds a separate item per service — the
9am doors plus the online message it carries, and an 11am doors a minute longer to
match — so reporting the merged item there would call the mirror wrong when its
total is exactly right.

## Output shape

```
[ PRE entries ... ]        run once, never duplicated
[ boundary block "9am" ]   serviceProfiles.boundaryBlockId
[ service entries ... ]    the master section
```

Every entry is linked to the one above it, which is what makes the rundown move
as one when something runs long. Two are not, and neither needs a rule: the first
entry of the morning has nothing above it, and the mirrored service's first entry
links to something outside its own section, which `regenerateInstances` drops
rather than dragging the 11am back to the end of the 9am. Links are only written
where the times already meet, so a link never moves an entry — a gap, which
`preAnchor: 'plan-time'` can leave, stays a gap.

The 11am is **not** written by this connector. It is derived by
`regenerateInstances` from `ServiceProfile.offset`, computed as the gap between
the plan's first and second service times. That keeps "9am is master, 11am is
re-derived" true for imports as well as for hand edits.

## Sectioning

The PRE section runs from the top of the plan up to **and including** the item
matching `preBoundaryTitleMatch`. The boundary block goes immediately after it.

The shipped value is blank, which means no PCO item closes PRE: everything the
plan holds is part of the master service, and PRE is entirely the inferred
production run above. A blank pattern is a decision rather than a failure, so it
does not warn; a pattern that matches nothing still does.

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

The connector is a provider behind the rundown-source API, the same one that recalls
a worksheet tab from the linked Google Sheet, and both are listed at once. See
`apps/spec/rundown-sources.md` for the commands.

**One source per pinned service type**, named after the service type:

```
1  Central AM
2  Central PM
```

```
/ontime/loadsource/pco "Central AM"   # this Sunday's Central AM
/ontime/loadsource/pco 1              # the same, by position
```

Not one source per plan, which is what this used to be. A button labelled
_Central AM_ still means the right thing next Sunday; a button holding `2026-08-23`
is dead by Monday. Which plan it resolves to is decided when the recall runs: the
soonest plan dated **today or later**.

That boundary is the whole question on a Sunday morning, so it does not rely on
PCO's `filter=future`, whose treatment of today's plan is undocumented. It queries
`filter=after&after=<today>` instead, which is inclusive — verified live:
`after=2026-08-23` returns the plan dated 2026-08-23. Today is read in the
configured timezone.

Two campuses can pin service types with the same name, in which case the source name
is qualified by its campus group, and by the service type id if even that collides.

A recall builds the rundown, then replaces the project's rundown and service
profiles and regenerates the 11am. It is **refused while playback is running** and
custom fields are left alone, because a plan carries no column mapping. Divergence
between the two service times is written to the log rather than flattened silently.

### Credentials

A Personal Access Token pair from
<https://api.planningcenteronline.com/oauth/applications>, needing read access to
Services. Three places it can come from, in this order:

1. **The settings panel.** Saved to `pco-credentials.json` in the Ontime data
   directory, written 0600. This is what makes the connector deployable to another
   campus: nobody has to touch a file on the machine.
2. `PCO_APP_ID` / `PCO_SECRET` in the environment.
3. A `.env` in the Ontime data directory or the working directory.

Saved credentials win over the environment, because a token typed into the panel has
to take effect — deferring to a variable somebody exported months ago would look
like the save had failed. The panel reports which source is in use, so the
precedence is visible rather than a surprise.

The secret is write-only: it is never sent back to the browser, never logged, and
what the panel shows instead is a masked application id. It is checked against
Planning Center before it is stored, because a typo in a token leaves nothing to
look at afterwards. It is kept in the data directory and **not** in the project
file, which gets exported and passed around.

### Turning it on

Credentials are the ability; the **Offer plans to Companion and OSC** switch on the
settings panel (`enabled` in `pco-rules.json`) is the decision. With both, the
pinned service types join the recallable rundown sources — _alongside_ the Google
Sheet tabs, taking nothing away from them.

Which service type a bare recall resolves to is `PCO_SERVICE_TYPE_ID`, else
`serviceTypeId`, else `serviceTypeName` (a case-insensitive substring, so
`central am` finds _Central AM Service_), else the first **pinned** service type,
else the organisation's only one. Anything ambiguous is an error listing the ids to
choose from — this organisation has 329 service types, so guessing would be worse
than failing.

## The settings panel

Two entries under _Planning Center_ in app settings, both editing the same
`pco-rules.json`. Every control saves immediately: a dirty form on either would
have to write the whole file back, silently reverting the other.

**Import from Planning Center** — connection state, the credentials, the switch
above, the pinned service types, and the upcoming plans across them with an Import
button per plan. Pinning exists because of the 329: the picker is a search, and what
gets used is kept. A pin carries an optional campus heading, which groups the plan
list and disambiguates a shared service type name. The pins are also exactly what a
recall can address, so pinning is how a campus decides what its Companion buttons
can reach. Importing replaces the rundown and the service profiles, and is refused
while a show is running.

Unlike a recall, an import here names a specific dated plan, which is what makes it
useful for building next month's service ahead of time.

**Import defaults** — three things, in the order the morning runs.

The default timing applied to every event, and what run sheet headings become.

Then _Before the run sheet_: the production run, as a table of steps and lengths.
Offsets are never typed in — each step follows the one before and the last hands
over to the plan's first item, so a length changed anywhere re-times everything
ahead of it and the chain cannot drift. The table owns the `pre-start` inferred
entries and leaves any other anchor alone.

Then the items Planning Center actually carries, read from the next few run sheets
of a pinned service type. Each row offers timing, hide timer, aux timer and skip,
and writes a rule matching that title. A row that cannot take those settings says
why and is disabled rather than offering a control that would do nothing — it
imports as a block, or is folded in with its section, or is merged into the entry
above, or is not imported at all.

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

`<data dir>/pco-rules.json` is merged over `defaultPcoRules`, so the file only
needs the keys it changes. Anything absent follows the shipped defaults, which do
move between versions — that is deliberate, and why the seeded file holds only
the switch and the service type rather than a snapshot of everything.

An item is claimed by the first of these that matches it:

1. `collapseSections` — a whole section folded into one event. The section runs
   from the matched item (normally its header) to the item before the next
   header, which is how PCO delimits one. The fold keeps the section's total
   length, and lists what it folded in as the event's note so the set list is not
   lost. A header claimed by a fold survives a rule that drops every other
   header.
2. `mergeIntoPrevious` — the item gives its length to the entry above it instead
   of taking a row. Not the same as ignoring: the pre-service run back-times to
   the service, so ignoring one minute of it would move the published doors time
   a minute later. Merging it does not.
3. `ignoreItems` — never reaches the rundown, and its length goes with it.

What survives becomes an entry, and the rest of the file shapes it:

- `headersBecome` — `nothing` (shipped), `block` or `event`. A header still
  delimits a section for `collapseSections` whichever this is.
- `defaultEffect` — applied to every event, then overridden by the first matching
  `timerRules` entry. A `title` here is ignored: a rename belongs to one rule,
  and in the defaults it would retitle the whole rundown.
- `fixedDurationCarriesForward` — once an entry in a section holds its own
  duration, every later entry in that section holds its own too. The message is a
  fixed-duration countdown and can overrun; anything after it counting down to a
  wall clock time would absorb that overrun and shrink, so a two minute
  announcement quietly becomes thirty seconds. Scoped per section, because a
  section starts where the run sheet says it starts.
- `timerRules` — first match wins. `titleContains` is a literal, case-insensitive
  substring and is what the settings panel writes; `titleMatch` is a regex for
  rules written by hand. An effect can set the timer type, the strategy, the
  colour, the switches, and `title` to rename the event.
- `inferredEntries` — entries the run sheet implies but never states, positioned
  by an anchor (`pre-start`, `service-start`, `service-end`) plus a signed
  offset. The settings panel owns the `pre-start` chain as a table of lengths and
  recomputes the offsets; entries on other anchors are left alone.
- `titleStrip` — regex removed from every title, which is how
  `Doors Open // 9am` becomes `Doors Open`.
- `respectMasterExclusions` — drop items PCO excludes from the master service, so
  the mirror is the only thing that generates the other service.
- `serviceNames` — the block names, chronologically.

`pco-rules.example.json` next to this file carries a full example.

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

- Building a plan for a chosen day. `buildRundownFromPlan` takes a `targetDate` and
  reports `availableDays`, and the import route accepts one, but neither the panel
  nor a recall offers the choice yet.
- Editing hand-written pattern rules in the panel, and reordering rules.
- Honouring `ItemTime` divergence instead of only warning about it.
- OAuth 2, if this ever needs to serve more than one organisation.

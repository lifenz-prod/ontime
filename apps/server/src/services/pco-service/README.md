# Planning Center connector

Generates an Ontime rundown from a Planning Center Online (PCO) Services plan,
including the PRE section and both Sunday services.

## Status

Usable. The API client, the rundown builder and the rules config are unit tested
against a fixture shaped like a real Central AM plan. The connector is registered
as a **rundown source provider**, so a plan can be recalled over OSC, websocket or
HTTP, an import page at `/pco-import` for picking a plan and saying what each of its
items becomes, and a settings panel for credentials, pins and defaults.

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

**The item list starts at doors, but the plan does not.** Everything earlier —
soundchecks, rehearsals, production checks, the briefings — is on the plan as
`PlanTime` records rather than as items:

| Need                  | PCO source                                             |
| --------------------- | ------------------------------------------------------ |
| The production run    | `PlanTime.starts_at`/`ends_at`, `time_type: 'rehearsal'` |
| The two briefings     | header items stating a time in their **title**          |
| Power on              | nowhere — the one part that is still stated in config   |

So the morning above the run sheet is read, not transcribed. `deriveRehearsalTimes`
turns each rehearsal time into an entry at the name, start and length the plan
gives it; `deriveTimedHeaders` reads _SERVICE BRIEFING 8:05am_ and _BROADCAST
BRIEF 8:10am_, whose times exist only in their title text. Both halves meet
exactly: the last rehearsal time ends at 8:05, and the briefs hand over to the run
sheet's first item at 8:20.

This replaced a hand-entered `inferredEntries` chain, and the reason is what the
transcription had quietly become. It called the 06:55 slot _Circle Time_ — the
name from the **midweek** rehearsal, where Sunday's is _Creative Team Prayer_ — it
still said _Link Brief_ after PCO renamed it _Broadcast Brief_, it had the sync at
15:00 where the plan says 10:00 with a five minute gap after it, and it had no
idea the vocalists rehearse alongside the band. None of that was visible from
inside Ontime.

Three shapes the plan has that a rundown does not, and what happens to them:

- **Gaps.** The sync ends at 06:25 and the call time starts at 06:30. The plan
  means it, so the gap survives and the two entries do not link.
- **Overlaps.** The band and the vocalists rehearse in different rooms from 06:35
  to 06:55. The first keeps the row; the rest go in its note.
- **Staffing call times.** `other` times — kitchen, carpark, the producer's whole
  morning, a dozen more — overlap each other and both services and are never
  entries. They can still anchor a run under `preAnchor: 'plan-time'`.

`leadIn` is the last thing still stated rather than read: an hour of _Power On_
ending where the first rehearsal time starts, so the first timer has something to
run against. It moves when the plan moves. Set it to `null` for a morning that
opens on its first rehearsal time.

The prayer meeting is a 25:00 `pre` item and closes PRE — see Sectioning.

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
where the times already meet, so a link never moves an entry — a gap the plan
leaves between two rehearsal times stays a gap.

The 11am is **not** written by this connector. It is derived by
`regenerateInstances` from `ServiceProfile.offset`, computed as the gap between
the plan's first and second service times. That keeps "9am is master, 11am is
re-derived" true for imports as well as for hand edits.

## Sectioning

The PRE section runs from the top of the plan up to **and including** the item
matching `preBoundaryTitleMatch`. The boundary block goes immediately after it.

The shipped value is `prayer meeting`, and the choice is load-bearing. The prayer
meeting is the last thing that happens once; doors — the item straight after it —
is the first thing each service does for itself. Putting the boundary between them
is what stops the mirror generating a second prayer meeting at 10:20 while still
letting it generate the 11am's doors.

A blank pattern is a decision rather than a failure, so it does not warn: PRE is
then only the derived production run, and every PCO item is part of the master. A
pattern that matches nothing still warns.

`preAnchor` decides where the pre-service run starts:

- `back-from-service` (default) — how PCO itself works, and what the real sheet
  matches: the run back-times to end at the service start.
- `plan-time` — anchors forward from the earliest non-service `PlanTime` on the
  chosen day. Falls back to back-timing when the day has no such time.

  With `deriveRehearsalTimes` on, rehearsal times are skipped when looking for that
  anchor: one that has become an entry of its own cannot also be what the run sheet
  hangs off, or doors would be dragged up on top of the 06:15 sync.

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

## The import page

`/pco-import`, its own route rather than a settings section. Choosing a plan and
saying what each of its items becomes is an operator's task, done against a run
sheet minutes before a service and wanting the width of a screen; settings keeps
what is genuinely configuration.

Two steps. First the upcoming plans of every pinned service type, grouped by campus
heading. Then the chosen plan's **whole morning**, in order: the lead-in, the
production run read from the plan's rehearsal times, then the run sheet with its own
lengths — not a tally of the titles the next few plans share, which is what the
settings panel offers. Every row is an entry the import will make, so every row is
listed and every row is editable.

Only the build day's rehearsal times. A plan routinely carries a midweek rehearsal
alongside the Sunday one, and a rundown is a single day: the Wednesday times belong
to a morning this import is not building. A row the plan fixes on the clock shows
its start; a run sheet item does not, because its place depends on the whole build.

Each row says what the import will do with it and lets that be changed:

| Control      | What it does                                                     |
| ------------ | ---------------------------------------------------------------- |
| Import as    | a timed event, a block, or left out                              |
| Timing       | countdown to a time of day, or a fixed duration                  |
| At the end   | the event's end action                                           |
| Hide timer / Aux timer / Skip | the switches an event carries               |

**Every row can be asked for as a timed event**, and a choice made on a row beats
every rule that would otherwise claim the item -- a fold, a merge, the ignore list,
`headersBecome`. There is no other way for somebody reading the sheet to give a cue
to something the rules took away, so nothing is out of reach of its own row.

What that changes about how a folded section reads. The heading that opens the fold
_is_ the event -- it carries the section's time and takes every timer setting -- so
its row says **Timed event**. The songs folded into it get no cue of their own, so
theirs say **Leave out**, with a note saying which entry their time went into. Ask
for one as a timed event and it comes out of the fold with its own length, and the
block is that much shorter. Leave the heading out and the whole fold goes, songs and
all, each standing on its own.

A row that is not a timed event carries no timer settings, so those controls are
disabled -- but "Import as" never is.

A heading whose title states a time is fully editable, and is named the way the
entry will be named — _SERVICE BRIEFING_, not _SERVICE BRIEFING 8:05AM_ — because a
rule written from a row has to match the entry the build makes. `importAs` reaches
the production run as well, so a step nobody runs can be left out from its row; the
gap it leaves stays a gap, since the plan still says when the step either side of it
happens.

**Choices are remembered per service type.** A run sheet item means different things
on different ones — "Message" is forty minutes on Central AM and twenty-five on
Central PM — so a change is written to `serviceTypeRules[<id>]` and applied to that
service type's next plan, leaving the others alone. The row carries a badge when the
service type holds a choice of its own, and the reset button removes it.

A rule written this way holds **only what was chosen**. The controls show the
resolved effect, which is what the import will really do, but a change is applied to
what the service type explicitly holds — otherwise toggling one switch would freeze
today's `defaultEffect` into the rule, and the row would stop following defaults it
never had an opinion about.

Importing replaces the rundown and the service profiles, and is refused while a show
is running. Unlike a recall, an import here names a specific dated plan, which is
what makes it useful for building next month's service ahead of time.

## The settings panel

Two entries under _Planning Center_ in app settings, both editing the same
`pco-rules.json`. Every control saves immediately: a dirty form on either would
have to write the whole file back, silently reverting the other.

**Import from Planning Center** — connection state, the credentials, the switch
above, the pinned service types, and the way out to the import page. Pinning exists
because of the 329: the picker is a search, and what gets used is kept. A pin
carries an optional campus heading, which groups the plan list and disambiguates a
shared service type name. The pins are also exactly what a recall can address, so
pinning is how a campus decides what its Companion buttons can reach.

**Import defaults** — three things, in the order the morning runs.

The default timing applied to every event, and what run sheet headings become.

Then _Before the run sheet_: two switches for what gets read off the plan, and the
lead-in, which is the only part of the morning still stated. Below them a table of
steps the plan does not hold, normally empty — offsets are never typed in, each
step follows the one before and the last hands over to the plan's first item. The
table owns the `pre-start` inferred entries and leaves any other anchor alone.

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
  colour, the switches, `title` to rename the event, and `importAs` to decide
  whether it becomes an event, a block, or nothing at all.
- `serviceTypeRules` — the same rules, keyed by Planning Center service type id and
  applied ahead of `timerRules`. Written by the import page and not meant to be
  edited by hand.
- `deriveRehearsalTimes` — the plan's `rehearsal` times become the production run
  ahead of the run sheet, at the names and times PCO gives them.
- `deriveTimedHeaders` — headers stating a clock time in their title become
  entries at that time, running until whatever starts next. Only headers timed
  before the service, and only lengthless ones: a header carrying length would
  shift the service if it were pulled out of the run.
- `leadIn` — `{ title, duration }` ending where the first derived entry starts, or
  `null` for none.
- `inferredEntries` — entries the plan holds nowhere at all, positioned by an
  anchor (`pre-start`, `service-start`, `service-end`) plus a signed offset. The
  settings panel owns the `pre-start` chain as a table of lengths and recomputes
  the offsets; entries on other anchors are left alone.
- `titleStrip` — regex removed from every title, which is how
  `Doors Open // 9am` becomes `Doors Open`.
- `normaliseTitleCase` — give a title the run sheet SHOUTS leading capitals, so
  `PRAISE & WORSHIP` becomes `Praise & Worship`. A printed run sheet is scanned
  across a page and a rundown is read at a glance off a timer screen; the two do
  not want the same typography. Only a title that is **entirely** upper case is
  touched, because a single lower case letter means somebody cased it on purpose
  and recasing it would spell `EOS Announcements` as `Eos Announcements`. A word
  glued to a digit is left alone for the same reason, so `8:05AM` survives.
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
- A length for a timed heading. The plan states when the briefing starts and not
  how long it runs -- that is decided by whatever follows it -- so the row shows a
  start and no length.
- OAuth 2, if this ever needs to serve more than one organisation.

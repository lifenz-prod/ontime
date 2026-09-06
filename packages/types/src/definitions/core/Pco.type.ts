import type { EndAction } from '../EndAction.type.js';
import type { TimerType } from '../TimerType.type.js';
import type { TimeStrategy } from '../TimeStrategy.type.js';

/**
 * Rules that turn a Planning Center run sheet into an Ontime rundown, and the
 * summaries the settings UI reads.
 *
 * A run sheet says what happens and how long each thing lasts. It does not say
 * which Ontime timer type each segment wants, and it leaves some of the morning
 * implicit. Those gaps are filled by rules rather than by code, so they can be
 * tuned against real plans without a rebuild.
 *
 * The rules live at `<ontime data dir>/pco-rules.json` and are merged over the
 * defaults in the server's `pcoRules.ts`, so the file only needs the keys it wants
 * to change. They are shared with the client because the settings panel edits them.
 */

/** where in the service an item sits; only `during` counts toward a plan's total length */
export type PcoServicePosition = 'pre' | 'during' | 'post';
export type PcoItemType = 'song' | 'header' | 'media' | 'item';
/** what a run sheet heading turns into; see `PcoRules.headersBecome` */
export type PcoHeaderHandling = 'block' | 'event' | 'nothing';

/** properties applied to a generated Ontime event */
export type PcoRuleEffect = {
  /**
   * Replaces the event's title.
   *
   * Run sheet titles are written for the people reading the sheet, not for a
   * timer screen: "Message (Incl. Altar Call) // One Way Link" is one column wide
   * in Planning Center and far too long in Ontime. Only ever set this on a rule --
   * a rename in `defaultEffect` would retitle the whole rundown, so the builder
   * ignores it there.
   */
  title?: string;
  timerType?: TimerType;
  /** Ontime's "Countdown to Time" - the event counts down to a wall clock time */
  countToEnd?: boolean;
  timeStrategy?: TimeStrategy;
  endAction?: EndAction;
  colour?: string;
  isPublic?: boolean;
  skip?: boolean;
  hideTimer?: boolean;
  showAsAuxTimer?: boolean;
  /**
   * Whether the item becomes a timed event at all.
   *
   * Overrides `headersBecome` for the one item it matches, and `'omit'` does what
   * an `ignoreItems` entry would -- which is what makes the import page able to
   * decide this per row rather than by editing the rule lists. Absent, the item
   * follows the shipped behaviour for its kind.
   */
  importAs?: PcoItemImportAs;
};

/**
 * How an item that lists what it includes is broken up.
 *
 * The parts are entries of their own at zero length, which is what makes them
 * something to set a time on rather than something to create.
 */
export type PcoSplitRule = {
  /** regex over the title, with one capture group holding the list */
  match: string;
  /** regex splitting the captured list into parts */
  separator: string;
};

/**
 * An entry added straight after a matched item, taking time the item was held back
 * from.
 *
 * The prayer meeting is the case this exists for. The plan gives it the whole
 * stretch from 8:20 to doors, but the room is only praying for the first ten
 * minutes of it; the rest is the band clearing the stage and the doors team getting
 * into place, and the person calling the morning wants a cue on that changeover
 * rather than one timer covering both.
 *
 * `hold` is what the item is given, and the entry that follows takes the remainder,
 * so the run's total is unchanged and nothing after it moves. Without a `hold` the
 * entry is added at nothing, a placeholder to give a time to on the day.
 */
export type PcoFollowOnRule = {
  /** label shown in the settings panel and in import warnings, not matched against anything */
  name: string;
  match: PcoRuleMatch;
  /** what the added entry is called */
  title: string;
  /** milliseconds the matched item is held to; absent leaves its own length alone */
  hold?: number;
  effect?: PcoRuleEffect;
};

/** what an item becomes, when a rule decides it rather than the item's kind */
export type PcoItemImportAs =
  /** a timed event of its own */
  | 'event'
  /** a divider carrying no timer, though its length still shifts what follows */
  | 'block'
  /** never reaches the rundown, and its length goes with it */
  | 'omit';

/**
 * All present fields must match, and an empty match matches nothing.
 *
 * `titleContains` is a literal, case-insensitive substring: it is what the settings
 * panel writes, because a run sheet title is not a regex and nobody should have to
 * escape one. `titleMatch` is a case-insensitive regex source, kept for rules
 * written by hand which need an anchor or an alternation.
 */
export type PcoRuleMatch = {
  titleContains?: string;
  titleMatch?: string;
  itemType?: PcoItemType;
  servicePosition?: PcoServicePosition;
};

export type PcoTimerRule = {
  /** label shown in the settings panel and in import warnings, not matched against anything */
  name: string;
  match: PcoRuleMatch;
  effect: PcoRuleEffect;
};

/**
 * A whole run sheet section folded into one Ontime event.
 *
 * A worship set is five songs on the sheet and one 22 minute segment to the person
 * calling the show: nobody cues the third song, they cue the end of worship. The
 * fold keeps the section's total length, so everything after it still lands where
 * the sheet says.
 *
 * The section runs from the matched item to the item before the next header, which
 * is how Planning Center delimits a section in the first place.
 */
export type PcoCollapseRule = {
  /** label shown in the settings panel and in import warnings */
  name: string;
  /** the item that opens the section -- normally its header */
  match: PcoRuleMatch;
  /** what the folded event is called. Defaults to the matched item's own title */
  title?: string;
  effect?: PcoRuleEffect;
  /**
   * Put the titles of what was folded in into the event's note, so the set list
   * survives the fold. Defaults to true.
   */
  listContents?: boolean;
  /**
   * Which of the section's items are folded in. Absent folds the whole section.
   *
   * The worship set is not only songs: an MC moment sits in the middle of it, and
   * Planning Center types it `item` where every song is typed `song`. Somebody does
   * cue that moment, so folding it into the block takes away the one cue the
   * section has. With `{ itemType: 'song' }` the songs fold and it does not.
   *
   * Only **consecutive** matching items fold together, so a section that goes
   * songs, MC moment, songs becomes three entries in that order rather than one
   * block and a moment that has moved.
   */
  membersMatch?: PcoRuleMatch;
};

/**
 * An entry that the run sheet implies but never states.
 * Positioned by an anchor plus a signed offset, so it tracks the plan when times move.
 */
/**
 * The lead-in ahead of the derived production run.
 *
 * It has no counterpart in Planning Center -- powering the building on is not
 * something the plan records -- so it is the one entry of the morning still stated
 * here rather than read. It ends where the first derived entry starts.
 */
export type PcoLeadIn = {
  title: string;
  /** milliseconds */
  duration: number;
  effect?: PcoRuleEffect;
};

export type PcoInferredEntry = {
  name: string;
  title: string;
  /** which section the entry belongs to */
  section: 'pre' | 'service';
  anchor: 'pre-start' | 'service-start' | 'service-end';
  /** milliseconds from the anchor; negative is before it */
  offset: number;
  /** milliseconds */
  duration: number;
  effect?: PcoRuleEffect;
};

/**
 * A service type kept on the import tab.
 *
 * The organisation this was built for has over three hundred service types, so the
 * ones actually used are pinned. `group` is the campus heading they sit under.
 */
export type PcoPinnedServiceType = {
  id: string;
  name: string;
  /** campus or other heading, eg "Central". Null groups sort last under "Other" */
  group?: string | null;
};

export type PcoRules = {
  /**
   * Whether the pinned service types are offered as recallable rundown sources.
   *
   * Additive: Planning Center is listed alongside the Google Sheet tabs, and
   * neither hides the other. Off by default all the same, so a machine that holds
   * credentials for some other reason does not start answering recalls.
   */
  enabled: boolean;
  /** IANA zone used to turn PCO's UTC timestamps into an Ontime time of day */
  timezone: string;
  /** PCO service type to pull plans from, as shown by the probe or the server log */
  serviceTypeId: string | null;
  /** alternative to serviceTypeId: the service type's name in PCO, matched case insensitively */
  serviceTypeName: string | null;
  /** service types kept on the import tab, in display order */
  pinnedServiceTypes: PcoPinnedServiceType[];
  /**
   * The PRE section runs from the top of the plan up to and including the item
   * whose title matches this. The Ontime boundary block is inserted right after,
   * so everything below it becomes the mirrored master service section.
   */
  preBoundaryTitleMatch: string;
  /**
   * How the pre-service run is placed.
   *
   * 'back-from-service' is how Planning Center itself works and is the default:
   * every `service_position: 'pre'` item back-times as one contiguous run ending
   * at the service start, so doors, walk-in and the pre-service video land where
   * the run sheet says they do.
   *
   * 'plan-time' instead anchors the run forward from the earliest non-service
   * PlanTime on the chosen day. Only useful when the plan's pre-service lengths
   * do not add up to the real call time.
   */
  preAnchor: 'plan-time' | 'back-from-service';
  /** display names for the service instances, chronological; falls back to PCO plan time names */
  serviceNames: string[];
  /**
   * What a Planning Center `header` turns into.
   *
   * 'nothing' drops it, which is usually right: a header is a heading on a printed
   * run sheet, and a rundown being called has no use for one. 'block' makes it an
   * Ontime block, a divider carrying no time. 'event' gives it a row of its own,
   * which only helps when the headers carry length.
   *
   * A header delimits a section for `collapseSections` whichever of these is set.
   */
  headersBecome: PcoHeaderHandling;
  /**
   * Sections folded into a single event. Applied before `ignoreItems`, so a header
   * that opens a folded section survives a rule that drops every other header.
   */
  collapseSections: PcoCollapseRule[];
  /**
   * Items that give their length to the entry above them instead of getting a row
   * of their own.
   *
   * Not the same as ignoring: an ignored item takes its time out of the run sheet,
   * and everything after it moves. A pre-service run back-times to the service, so
   * ignoring one minute of it would push the published doors time a minute later.
   */
  mergeIntoPrevious: PcoRuleMatch[];
  /**
   * Items matching any of these never reach the rundown, and their length goes
   * with them. Applied after `collapseSections` and `mergeIntoPrevious`.
   */
  ignoreItems: PcoRuleMatch[];
  /**
   * Regex removed from item titles. Plans express per-service variants in the
   * title -- "Doors Open // 9am" alongside "Doors Open // 11am" -- and only the
   * master's variant survives the exclusion filter, so the suffix is noise by
   * the time it reaches the rundown. Empty string disables the cleanup.
   */
  /**
   * Patterns removed from every title: what a run sheet carries for the people
   * reading it and a timer screen has no use for.
   *
   * The shipped pair are the per-service suffix -- "Doors Open // 9am" alongside
   * "Doors Open // 11am", where only the master's variant survives the exclusion
   * filter anyway -- and a video's own running time, "Father's Day VID (1:58)".
   * Applied in order, and a bare string is still read as a list of one.
   *
   * A duration is matched as a clock inside brackets on purpose, so it takes
   * "(1:58)" and leaves "(Incl. Ministry & Altar Call)" alone.
   */
  titleStrip: string | string[];
  /**
   * Give a title the run sheet SHOUTS leading capitals.
   *
   * Planning Center headings are written in caps -- "PRAISE & WORSHIP", "SERVICE
   * BRIEFING", "END" -- because a printed run sheet is scanned across a page. A
   * rundown is read at a glance off a timer screen and does not want the same
   * typography.
   *
   * Only a title that is entirely upper case is touched; anything with a lower case
   * letter in it was cased deliberately, and recasing it would turn "EOS
   * Announcements" into "Eos Announcements".
   */
  normaliseTitleCase: boolean;
  /**
   * How a particular word is spelled in a title, whatever the sheet does with it.
   *
   * Casing alone cannot settle this. "Father's Day VID" and "EOS Announcements" are
   * the same shape -- a three letter word in caps inside a title that is not -- and
   * one is short for "video" while the other is an acronym somebody says out loud.
   * No rule reads that off the letters, so the ones that matter are named here and
   * everything else is left exactly as the sheet writes it.
   *
   * Matched on whole words, case insensitively.
   */
  titleWords: Record<string, string>;
  /**
   * Items whose title lists what they include, split into an entry each.
   *
   * "Message (Incl. Ministry & Altar Call)" is three things on one row: the sheet
   * has no reason to separate them and the desk very much does. It becomes the
   * message, holding the item's whole length, and then Ministry and Altar Call at
   * nothing -- placeholders the stage producer gives a time to on the day, or
   * deletes when the week does not need them. Making them by hand every week is the
   * job this is meant to save.
   *
   * `match` is a regex with one capture group holding the list; `separator` splits
   * that capture into parts. Null does nothing.
   */
  splitIncluded: PcoSplitRule | null;
  /**
   * Entries added after an item, taking time the item is held back from.
   *
   * The shipped rule holds the prayer meeting to ten minutes and gives the rest of
   * its slot to "End Of Prayer Meeting", so the changeover between praying and doors
   * has a cue of its own. The total is unchanged, so doors still open when the sheet
   * says. An item shorter than its hold keeps the hold and warns, since that does
   * move the run's start.
   */
  followOn: PcoFollowOnRule[];
  /**
   * Drop items that PCO excludes from the master service time.
   *
   * This matters: a plan holding both "Doors Open // 9am" and "Doors Open // 11am"
   * would otherwise put both in the master section, and the mirror would double
   * each of them. With this on, the master keeps only what PCO says belongs to it
   * and the mirror generates the rest.
   */
  respectMasterExclusions: boolean;
  /**
   * Once something in a section holds its own duration, everything after it in
   * that section holds its own too.
   *
   * The message is a fixed-duration countdown, so it can overrun. Anything after
   * it counting down to a wall clock time would absorb that overrun and shrink --
   * a two minute announcement quietly becoming thirty seconds. With this on, the
   * rest of the section keeps its lengths and moves instead.
   *
   * Per section, because a section always starts where the run sheet says it does:
   * PRE is its own run, and the mirror clones the master.
   */
  fixedDurationCarriesForward: boolean;
  /** applied to every event, then overridden by the first matching timer rule */
  defaultEffect: PcoRuleEffect;
  /** first match wins */
  timerRules: PcoTimerRule[];
  /**
   * Rules that apply to one service type only, keyed by its Planning Center id.
   *
   * The import page writes here. A run sheet item means different things on
   * different service types -- "Message" is forty minutes on Central AM and
   * twenty-five on Central PM -- so a choice made while importing one is
   * remembered for the next plan of that service type and left out of the others.
   *
   * Applied ahead of `timerRules`, since first match wins and the narrower scope
   * should win over the organisation-wide one.
   */
  serviceTypeRules: Record<string, PcoTimerRule[]>;
  /**
   * The production run before the run sheet's own items, taken from the plan's
   * `rehearsal` times.
   *
   * PCO holds the morning twice over: the run sheet items start at doors, and the
   * call sheet above them -- soundchecks, rehearsals, production checks -- is a set
   * of `rehearsal` plan times carrying their own names and clock times. Reading
   * them is what keeps the production run in step with the plan rather than with a
   * table somebody has to retype.
   *
   * `other` times are deliberately left out. They are staffing call times -- the
   * kitchen, the carpark, the producer's whole morning -- which overlap each other
   * and the services, and belong to no single row of a rundown.
   */
  deriveRehearsalTimes: boolean;
  /**
   * Headers whose title states a clock time become entries at that time.
   *
   * Two moments in the morning are recorded nowhere but in the text of a heading:
   * "SERVICE BRIEFING 8:05AM" and "BROADCAST BRIEF 8:10am". They carry no length
   * and sit in `during`, so without this they are dropped with every other header
   * and the run has a hole between the last rehearsal time and the run sheet.
   *
   * Only headers timed before the service are read; the time is taken from the
   * title and the entry runs until whatever starts next.
   */
  deriveTimedHeaders: boolean;
  /**
   * An entry ahead of the first derived one, so the first timer has something to
   * run against rather than the morning opening on a countdown already underway.
   *
   * Anchored to the derived run rather than to a clock time, so it moves with the
   * plan. Null leaves the morning starting at its first rehearsal time.
   */
  leadIn: PcoLeadIn | null;
  inferredEntries: PcoInferredEntry[];
};

/* -------------------------------------------------------------------------- */
/* what the settings UI reads                                                  */
/* -------------------------------------------------------------------------- */

export type PcoServiceTypeSummary = {
  id: string;
  name: string;
};

/**
 * Where a token pair came from.
 *
 * `stored` is the settings panel, kept in the Ontime data directory. `environment`
 * is PCO_APP_ID / PCO_SECRET, including a .env file. Saved credentials win, because
 * typing a token into the panel has to take effect.
 */
export type PcoCredentialSource = 'stored' | 'environment';

/** what the panel sends when someone enters a token pair. Never returned */
export type PcoCredentialsRequest = {
  applicationId: string;
  secret: string;
};

/**
 * Whether the connector can be used, and what it is pointed at.
 *
 * Reaching Planning Center and having chosen a service type are two different
 * things, and they are reported separately: an organisation with hundreds of
 * service types is connected but unconfigured, which is not a failure.
 */
export type PcoStatus = {
  /** a token pair is available, from the environment or saved in Ontime */
  hasCredentials: boolean;
  /** where the pair in use came from, null when there is none */
  credentialSource: PcoCredentialSource | null;
  /** the application id, masked. Never the secret */
  applicationIdHint: string | null;
  /** `enabled` in the rules file: Planning Center serves rundown sources */
  enabled: boolean;
  /** the API answered */
  connected: boolean;
  /** how many service types the organisation has, null when the API was not reached */
  serviceTypeCount: number | null;
  /** the service type used for recall over OSC, null when nothing is chosen yet */
  serviceType: PcoServiceTypeSummary | null;
  /** an actual failure -- bad credentials, no network. Not "nothing chosen yet" */
  error: string | null;
};

/** one plan, as shown on the import tab */
export type PcoPlanSummary = {
  serviceTypeId: string;
  serviceTypeName: string;
  planId: string;
  /** YYYY-MM-DD, the date the plan runs on */
  date: string;
  /** the plan's own prose date, eg "23 August 2026" */
  dates: string | null;
  title: string | null;
  seriesTitle: string | null;
  itemsCount: number | null;
  /**
   * Clock time of the first service, eg "09:00".
   *
   * Read from the plan's own sort_date, which is free. The later services are not
   * here: PCO only carries them on the plan's times, which would be one request
   * per plan just to render a list.
   */
  firstServiceTime: string | null;
};

/**
 * What the import does with an item, so the settings panel can say so rather than
 * offering controls that could not take effect.
 */
export type PcoItemDisposition =
  /** its own Ontime event */
  | 'event'
  /** an Ontime block: a divider, which takes no timer settings */
  | 'block'
  /** folded into one event with the rest of its section */
  | 'collapsed'
  /** its length given to the entry above it */
  | 'merged'
  /** never imported */
  | 'ignored';

/**
 * An item title seen across a service type's plans, so the settings panel can
 * offer what is actually on the run sheets instead of asking for a regex.
 */
export type PcoKnownItem = {
  title: string;
  itemType: PcoItemType;
  servicePosition: PcoServicePosition;
  /** how many of the sampled plans carry an item with this title */
  planCount: number;
  /** typical length in seconds, null when every occurrence is zero */
  typicalLength: number | null;
  /** the rule name currently matching this item, null when nothing does */
  matchedBy: string | null;
  /** what the import currently does with it, which decides whether a rule here can do anything */
  disposition: PcoItemDisposition;
};

export type PcoKnownItems = {
  serviceTypeId: string;
  serviceTypeName: string;
  /** how many plans were read to build the list */
  plansSampled: number;
  items: PcoKnownItem[];
};

/** where a row of the sheet comes from */
export type PcoPlanSheetSource =
  /** an item of the run sheet */
  | 'item'
  /** a `rehearsal` plan time, which is how PCO holds the production run */
  | 'rehearsal'
  /** the lead-in, the one entry the plan does not hold at all */
  | 'lead-in';

/**
 * One row of the morning, as the import page shows it.
 *
 * Where `PcoKnownItem` is a title tallied across the next few plans, this is one
 * row of one actual plan: the page shows the morning that is about to be imported
 * rather than a summary of the ones like it.
 *
 * The run sheet is only half of it. The rows above it -- the production run read
 * from the plan's rehearsal times, and the lead-in ahead of that -- are listed here
 * too, because they are entries in the rundown and leaving them out would make the
 * page a partial account of what the import does.
 */
export type PcoPlanSheetItem = {
  /** the PCO item or plan time id; the lead-in has a fixed synthetic one */
  id: string;
  source: PcoPlanSheetSource;
  /** as it will be titled after `titleStrip` and any rename */
  title: string;
  /** the title Planning Center holds, which is what a rule has to match */
  sourceTitle: string;
  itemType: PcoItemType;
  servicePosition: PcoServicePosition;
  /** milliseconds, as the plan states it */
  duration: number;
  /**
   * Milliseconds since midnight: where the row lands once the whole morning is laid
   * out, which is what the import will give it.
   *
   * Some rows the plan fixes directly -- a rehearsal time, the lead-in before it, a
   * heading whose title states a time. The run sheet's own rows are placed the way
   * the build places them: the pre-service run back-times to the service start,
   * `during` accumulates forward from it, and `post` carries on after that.
   *
   * Null only when no day was resolved, since nothing can be placed without a
   * service time to place it against.
   */
  startsAt: number | null;
  /** what the import will do with it as the rules stand */
  disposition: PcoItemDisposition;
  /** the rule deciding it, null when nothing matches */
  matchedBy: string | null;
  /** true when that rule is scoped to this service type rather than the whole organisation */
  matchedByServiceType: boolean;
  /**
   * What runs at the same time, for the rehearsal rows the plan overlaps: the band
   * and the vocalists rehearse in different rooms, and a rundown is linear, so one
   * keeps the row and this is what it carries in its note.
   */
  alongside: string | null;
  /**
   * The item this row was split out of, for a part of something that lists what it
   * includes. Null for a row the run sheet holds in its own right.
   */
  includedIn?: string | null;
  /**
   * The item this row was added after, for an entry a `followOn` rule creates. Null
   * for a row the run sheet holds in its own right.
   */
  follows?: string | null;
  /**
   * The service this item is excluded from in Planning Center, for one half of a
   * per-service pair -- a plan routinely holds "Doors Open // 9am" and
   * "Doors Open // 11am" as two items, each excluded from the other's time. Only the
   * master's half is imported; the mirror generates the rest, so importing both
   * would double them. Null for a row that belongs to every service.
   */
  excludedFrom?: string | null;
  /** everything the row's controls edit, already resolved through the rules */
  effect: PcoRuleEffect;
};

export type PcoPlanSheet = {
  serviceTypeId: string;
  serviceTypeName: string;
  planId: string;
  /** the plan's own title, which is often blank */
  planTitle: string;
  /** human readable, eg "6 September 2026" */
  dates: string;
  /** every day the plan touches, so the page can offer the choice */
  availableDays: { dateKey: string; label: string; hasServices: boolean }[];
  items: PcoPlanSheetItem[];
};

export type PcoImportRequest = {
  serviceTypeId: string;
  planId: string;
  /** YYYY-MM-DD, when the plan spans more than one day */
  targetDate?: string;
};

export type PcoImportResult = {
  planId: string;
  /** the day the rundown was built for */
  date: string;
  entries: number;
  warnings: string[];
};

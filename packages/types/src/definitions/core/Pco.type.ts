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

/** properties applied to a generated Ontime event */
export type PcoRuleEffect = {
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
};

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
 * An entry that the run sheet implies but never states.
 * Positioned by an anchor plus a signed offset, so it tracks the plan when times move.
 */
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
  /** PCO `header` items become Ontime blocks instead of events */
  headersAsBlocks: boolean;
  /** items matching any of these never reach the rundown */
  ignoreItems: PcoRuleMatch[];
  /**
   * Regex removed from item titles. Plans express per-service variants in the
   * title -- "Doors Open // 9am" alongside "Doors Open // 11am" -- and only the
   * master's variant survives the exclusion filter, so the suffix is noise by
   * the time it reaches the rundown. Empty string disables the cleanup.
   */
  titleStrip: string;
  /**
   * Drop items that PCO excludes from the master service time.
   *
   * This matters: a plan holding both "Doors Open // 9am" and "Doors Open // 11am"
   * would otherwise put both in the master section, and the mirror would double
   * each of them. With this on, the master keeps only what PCO says belongs to it
   * and the mirror generates the rest.
   */
  respectMasterExclusions: boolean;
  /** applied to every event, then overridden by the first matching timer rule */
  defaultEffect: PcoRuleEffect;
  /** first match wins */
  timerRules: PcoTimerRule[];
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
  /** dropped by `ignoreItems`, so no rule here can do anything */
  ignored: boolean;
};

export type PcoKnownItems = {
  serviceTypeId: string;
  serviceTypeName: string;
  /** how many plans were read to build the list */
  plansSampled: number;
  items: PcoKnownItem[];
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

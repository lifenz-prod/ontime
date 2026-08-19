/**
 * Rules that turn a Planning Center run sheet into an Ontime rundown.
 *
 * A run sheet says what happens and how long each thing lasts. It does not say
 * which Ontime timer type each segment wants, and it leaves some of the morning
 * implicit (doors, walk-in, band call). Those two gaps are filled here rather
 * than in code, so they can be tuned against real plans without a rebuild.
 *
 * The file lives at <ontime data dir>/pco-rules.json and is merged over these
 * defaults, so a partial file only needs the keys it wants to change.
 */

import { EndAction, TimeStrategy, TimerType } from 'ontime-types';

import type { PcoItemType, PcoServicePosition } from './pcoTypes.js';

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

/** all present fields must match; `titleMatch` is a case-insensitive regex source */
export type PcoRuleMatch = {
  titleMatch?: string;
  itemType?: PcoItemType;
  servicePosition?: PcoServicePosition;
};

export type PcoTimerRule = {
  /** label used in import warnings, not matched against anything */
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

export type PcoRules = {
  /** IANA zone used to turn PCO's UTC timestamps into an Ontime time of day */
  timezone: string;
  /** PCO service type to pull from; discovered via the API and written back here */
  serviceTypeId: string | null;
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

export const defaultPcoRules: PcoRules = {
  timezone: 'Pacific/Auckland',
  serviceTypeId: null,

  preBoundaryTitleMatch: 'prayer meeting',
  preAnchor: 'back-from-service',
  serviceNames: ['9am', '11am'],
  headersAsBlocks: true,

  ignoreItems: [],
  titleStrip: '\\s*//\\s*\\d{1,2}\\s*(am|pm)\\s*$',
  respectMasterExclusions: true,

  // the house rule: everything counts down to a wall clock time...
  defaultEffect: {
    timerType: TimerType.CountDown,
    countToEnd: true,
    timeStrategy: TimeStrategy.LockEnd,
    endAction: EndAction.None,
  },

  // ...except the message, which is a plain fixed-duration countdown
  timerRules: [
    {
      // anchored to the start of the title on purpose: an unanchored /message/
      // also catches "Online Pre Service Message", which is a to-time item
      name: 'message is a fixed-duration countdown',
      match: { titleMatch: '^\\s*(message|sermon)\\b' },
      effect: {
        timerType: TimerType.CountDown,
        countToEnd: false,
        timeStrategy: TimeStrategy.LockDuration,
      },
    },
  ],

  // Empty by design. Doors, walk-in and the pre-service video are all ON the run
  // sheet as `service_position: 'pre'` items, so they are imported, not inferred.
  // Add entries here only for things the sheet genuinely never states.
  inferredEntries: [],
};

/** Compiles a regex source, returning null rather than throwing on a bad pattern */
export function compileMatcher(source: string | undefined): RegExp | null {
  if (!source) {
    return null;
  }
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

export function matchesRule(
  match: PcoRuleMatch,
  candidate: { title: string; itemType: PcoItemType; servicePosition: PcoServicePosition },
): boolean {
  if (match.itemType && match.itemType !== candidate.itemType) {
    return false;
  }
  if (match.servicePosition && match.servicePosition !== candidate.servicePosition) {
    return false;
  }
  if (match.titleMatch) {
    const matcher = compileMatcher(match.titleMatch);
    if (!matcher || !matcher.test(candidate.title)) {
      return false;
    }
  }
  // an empty match object matches nothing, so a stray {} cannot swallow the rundown
  return Boolean(match.itemType || match.servicePosition || match.titleMatch);
}

/** Shallow merge of a user file over the defaults, ignoring keys we do not know */
export function mergePcoRules(partial: unknown): PcoRules {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ...defaultPcoRules };
  }
  const source = partial as Partial<PcoRules>;
  const merged: PcoRules = { ...defaultPcoRules };

  for (const key of Object.keys(defaultPcoRules) as (keyof PcoRules)[]) {
    const value = source[key];
    if (value === undefined || value === null) {
      // serviceTypeId is legitimately null, everything else keeps its default
      if (key === 'serviceTypeId' && value === null) {
        merged.serviceTypeId = null;
      }
      continue;
    }
    // @ts-expect-error -- key-wise copy across a heterogeneous record
    merged[key] = value;
  }
  return merged;
}

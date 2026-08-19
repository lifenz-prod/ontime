/**
 * The shipped Planning Center rules, and the matching logic they drive.
 *
 * The types live in ontime-types, because the settings panel edits them. What is
 * here is the values Ontime ships with, and the pure functions that apply them.
 *
 * The file at <ontime data dir>/pco-rules.json is merged over these defaults, so a
 * partial file only needs the keys it wants to change.
 */

import {
  EndAction,
  TimeStrategy,
  TimerType,
  type PcoItemType,
  type PcoRuleMatch,
  type PcoRules,
  type PcoServicePosition,
} from 'ontime-types';

export const defaultPcoRules: PcoRules = {
  enabled: false,
  timezone: 'Pacific/Auckland',
  serviceTypeId: null,
  serviceTypeName: null,
  pinnedServiceTypes: [],

  preBoundaryTitleMatch: 'prayer meeting',
  preAnchor: 'back-from-service',
  serviceNames: ['9am', '11am'],
  headersAsBlocks: true,

  // the briefing header is a `during` item with no length, so it would otherwise
  // become a block stranded in the middle of the service section, naming a time
  // that has already passed. Its one piece of information -- 8:05 -- is the
  // inferred entry below. Drop this rule to get the divider back.
  ignoreItems: [{ titleMatch: '^\\s*service briefing', itemType: 'header' }],
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

  // Doors, walk-in and the pre-service video are all ON the run sheet as
  // `service_position: 'pre'` items, so they are imported, not inferred.
  // Add entries here only for things the sheet genuinely never states.
  inferredEntries: [
    {
      // The service briefing is one of those things. PCO holds it nowhere: the
      // plan opens with a header titled "SERVICE BRIEFING 8:05AM" which carries
      // no length and sits in `during`, so those four characters of title text
      // are the only record that it happens.
      //
      // Anchoring it to the start of the pre-service run rather than to a clock
      // time is what makes it track the plan: the run back-times to the service,
      // so a service that moves takes the briefing with it. On the 23 August
      // plan the run starts at 8:20, which puts this at 8:05 -- the time the
      // header claims.
      //
      // The 15 minutes is the one number not derived from the data. It is the
      // gap between the title's 8:05 and the 8:20 the lengths add up to.
      name: 'Service Briefing',
      title: 'Service Briefing',
      section: 'pre',
      anchor: 'pre-start',
      offset: -15 * 60 * 1000,
      duration: 15 * 60 * 1000,
    },
  ],
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
  if (match.titleContains) {
    // a literal substring, so a title with regex characters in it needs no escaping
    if (!candidate.title.toLowerCase().includes(match.titleContains.trim().toLowerCase())) {
      return false;
    }
  }
  if (match.titleMatch) {
    const matcher = compileMatcher(match.titleMatch);
    if (!matcher || !matcher.test(candidate.title)) {
      return false;
    }
  }
  // an empty match object matches nothing, so a stray {} cannot swallow the rundown
  return Boolean(match.itemType || match.servicePosition || match.titleMatch || match.titleContains);
}

/** keys a user file may explicitly blank out, rather than falling back to the default */
const nullableRuleKeys = new Set<keyof PcoRules>(['serviceTypeId', 'serviceTypeName']);

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
      // the service type keys are legitimately null, everything else keeps its default
      if (value === null && nullableRuleKeys.has(key)) {
        // @ts-expect-error -- narrowed by nullableRuleKeys
        merged[key] = null;
      }
      continue;
    }
    // @ts-expect-error -- key-wise copy across a heterogeneous record
    merged[key] = value;
  }
  return merged;
}

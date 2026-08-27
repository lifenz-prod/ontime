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
  type PcoInferredEntry,
  type PcoItemType,
  type PcoRuleMatch,
  type PcoRules,
  type PcoServicePosition,
} from 'ontime-types';

/**
 * A contiguous run of entries ending at the start of the pre-service items.
 *
 * The production schedule is a chain: each step follows the one before, and the
 * last one hands over to whatever Planning Center says happens first. Written as a
 * list of lengths, the offsets are arithmetic rather than something to maintain --
 * moving Circle Time by five minutes here moves everything before it too.
 */
function preServiceRun(steps: { title: string; minutes: number }[]): PcoInferredEntry[] {
  const minute = 60 * 1000;
  let offset = -steps.reduce((total, step) => total + step.minutes, 0) * minute;

  return steps.map((step) => {
    const entry: PcoInferredEntry = {
      name: step.title,
      title: step.title,
      section: 'pre',
      anchor: 'pre-start',
      offset,
      duration: step.minutes * minute,
    };
    offset += step.minutes * minute;
    return entry;
  });
}

export const defaultPcoRules: PcoRules = {
  enabled: false,
  timezone: 'Pacific/Auckland',
  serviceTypeId: null,
  serviceTypeName: null,
  pinnedServiceTypes: [],

  /**
   * Nothing on the run sheet opens the master service section: everything before
   * doors is the production schedule below, which Planning Center does not hold.
   * Set this to a title to have a PCO item close the PRE section instead.
   */
  preBoundaryTitleMatch: '',
  preAnchor: 'back-from-service',
  serviceNames: ['9AM SERVICE', '11AM SERVICE'],

  // a header is a heading on the run sheet, not something anybody cues
  headersBecome: 'nothing',

  // the worship set is five songs to the band and one segment to the caller
  collapseSections: [
    {
      name: 'Praise & Worship',
      match: { itemType: 'header', titleContains: 'praise & worship' },
      // the sheet shouts its headings; the rundown does not have to
      title: 'Praise & Worship',
    },
  ],

  /**
   * The online message runs under the walk-in, so the room sees one continuous
   * "Doors Open" ending when the pre-service video starts. Merged rather than
   * ignored because the pre-service run back-times to the service: dropping its
   * minute outright would move doors from 8:45 to 8:46.
   */
  mergeIntoPrevious: [{ titleContains: 'online pre service message' }],

  /**
   * The prayer meeting is on the run sheet as one 25 minute pre-service item, and
   * in the production schedule below as two -- the meeting and the pack-down after
   * it. Keeping both would run it twice, so this side of it is dropped and the
   * pre-service run starts at doors instead.
   */
  ignoreItems: [{ titleContains: 'prayer meeting' }],

  titleStrip: '\\s*//\\s*\\d{1,2}\\s*(am|pm)\\s*$',
  respectMasterExclusions: true,

  // the message can overrun, so nothing after it counts down to a wall clock time
  fixedDurationCarriesForward: true,

  /**
   * The house rule: everything counts down to a wall clock time, and everything is
   * public. Public/private is not a distinction this church draws, so marking the
   * whole rundown public keeps the public views showing the whole morning rather
   * than making it something to remember per event.
   */
  defaultEffect: {
    timerType: TimerType.CountDown,
    countToEnd: true,
    timeStrategy: TimeStrategy.LockEnd,
    endAction: EndAction.None,
    isPublic: true,
  },

  // ...except the message, which is a plain fixed-duration countdown
  timerRules: [
    {
      /**
       * A message carried to the other campuses is titled for the sheet -- "Message
       * (Incl. Altar Call) // One Way Link" -- which is far more than a timer screen
       * needs. Only the linked variant is renamed: a week with a speaker in the room
       * keeps whatever the sheet calls it.
       */
      name: 'linked message',
      match: { titleMatch: '^\\s*(message|sermon)\\b.*\\blink\\b' },
      effect: {
        title: 'Message - LINK',
        timerType: TimerType.CountDown,
        countToEnd: false,
        timeStrategy: TimeStrategy.LockDuration,
      },
    },
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

  /**
   * The Sunday production schedule, which Planning Center holds nowhere.
   *
   * The plan starts at doors. Everything before it -- power on, soundcheck, the
   * briefing, the prayer meeting -- belongs to the production team, and the only
   * trace of any of it on the run sheet is two header titles reading "SERVICE
   * BRIEFING 8:05am" and "LINK BRIEF 8:10am".
   *
   * Anchoring the run to the pre-service items rather than to a clock time is what
   * makes it track the plan: the run back-times to the service, so a service that
   * moves takes the whole morning with it. On a 9:00 service with 15:00 of
   * pre-service items this puts doors at 8:45 and power on at 5:30, and the two
   * times the headers claim fall where they say they do.
   */
  inferredEntries: preServiceRun([
    { title: 'Power On', minutes: 45 },
    { title: 'Service Sync', minutes: 15 },
    { title: 'Call Time', minutes: 5 },
    { title: 'Band Soundcheck + Rehearsal', minutes: 20 },
    { title: 'Circle Time', minutes: 10 },
    { title: 'Vocal Soundcheck', minutes: 5 },
    { title: 'Mix Changes', minutes: 5 },
    { title: 'Link Worship Record', minutes: 5 },
    { title: 'Worship Rehearsal', minutes: 25 },
    { title: 'Production Checks', minutes: 20 },
    { title: 'Service Briefing', minutes: 5 },
    { title: 'Link Brief', minutes: 10 },
    { title: 'Prayer Meeting', minutes: 10 },
    { title: 'End of Prayer Meeting', minutes: 15 },
  ]),
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

/**
 * Shallow merge of a user file over the defaults, ignoring keys we do not know.
 *
 * `headersAsBlocks` is read for files written before headers gained a third
 * option, so an installation that turned the blocks off does not get them back.
 */
export function mergePcoRules(partial: unknown): PcoRules {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ...defaultPcoRules };
  }
  const source = partial as Partial<PcoRules> & { headersAsBlocks?: boolean };
  const merged: PcoRules = { ...defaultPcoRules };

  if (source.headersBecome === undefined && typeof source.headersAsBlocks === 'boolean') {
    merged.headersBecome = source.headersAsBlocks ? 'block' : 'event';
  }

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

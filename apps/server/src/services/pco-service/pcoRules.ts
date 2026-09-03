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

  /**
   * The prayer meeting closes PRE: it is the last thing that happens once, and
   * doors -- the item after it -- is the first thing each service does for itself.
   * Putting the boundary here is what keeps the mirror from generating a second
   * prayer meeting at 10:20 while still letting it generate the 11am's doors.
   */
  preBoundaryTitleMatch: 'prayer meeting',
  preAnchor: 'back-from-service',
  serviceNames: ['9AM SERVICE', '11AM SERVICE'],

  // a header is a heading on the run sheet, not something anybody cues
  headersBecome: 'nothing',

  /**
   * The worship set is several songs to the band and one segment to the caller.
   *
   * Only the songs though: Planning Center types them `song` and types the MC
   * moment sitting in the middle of the set `item`, and that moment is cued. So the
   * runs of songs either side of it fold and it keeps its own row.
   */
  collapseSections: [
    {
      name: 'Praise & Worship',
      match: { itemType: 'header', titleContains: 'praise & worship' },
      // the sheet shouts its headings; the rundown does not have to
      title: 'Praise & Worship',
      membersMatch: { itemType: 'song' },
    },
  ],

  /**
   * The online message runs under the walk-in, so the room sees one continuous
   * "Doors Open" ending when the pre-service video starts. Merged rather than
   * ignored because the pre-service run back-times to the service: dropping its
   * minute outright would move doors from 8:45 to 8:46.
   */
  mergeIntoPrevious: [{ titleContains: 'online pre service message' }],

  ignoreItems: [],

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
   * Written by the import page, one entry per service type. Empty until somebody
   * changes a row while importing, and never touched by hand.
   */
  serviceTypeRules: {},

  /**
   * The Sunday production schedule, which Planning Center does hold -- as the
   * plan's `rehearsal` times, each carrying its own name and clock time, plus two
   * headers that state a time in their title and nowhere else.
   *
   * Reading them is the difference between a morning that tracks the plan and one
   * transcribed into settings: the transcription this replaced had drifted, calling
   * the 06:55 slot "Circle Time" after the midweek rehearsal when Sunday's is
   * "Creative Team Prayer", and still naming a brief Planning Center had since
   * renamed.
   */
  deriveRehearsalTimes: true,
  deriveTimedHeaders: true,

  /**
   * The hour before the first rehearsal time. Powering the building on is the one
   * part of the morning the plan genuinely does not record, and the first timer
   * needs something to run against.
   */
  leadIn: { title: 'Power On', duration: 60 * 60 * 1000 },

  // everything the morning holds is now read from the plan
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
const nullableRuleKeys = new Set<keyof PcoRules>(['serviceTypeId', 'serviceTypeName', 'leadIn']);

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

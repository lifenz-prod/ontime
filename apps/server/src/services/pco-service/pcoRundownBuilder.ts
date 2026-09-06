/**
 * Turns a Planning Center plan into an Ontime rundown.
 *
 * Shape of the output, which is exactly what the fork's dual-service mirror expects:
 *
 *   [ PRE entries ... ]        <- run once, never duplicated
 *   [ boundary block "9am" ]   <- serviceProfiles.boundaryBlockId
 *   [ service entries ... ]    <- the master section
 *
 * The 11am is NOT written here. It is derived by regenerateInstances() from the
 * ServiceProfile offset, which we compute from the gap between the plan's two
 * service times. That keeps "9am is master" true for imports as well as edits.
 *
 * PCO items carry durations but no absolute start times, so times are accumulated
 * forward from a plan time's starts_at.
 */

import {
  isOntimeEvent,
  type PcoCollapseRule,
  type PcoInferredEntry,
  type PcoRuleEffect,
  type PcoRuleMatch,
  type PcoRules,
  OntimeBlock,
  OntimeEvent,
  OntimeRundown,
  OntimeRundownEntry,
  ServiceProfiles,
  SupportedEvent,
  TimeStrategy,
  TimerType,
} from 'ontime-types';
import { dayInMs, generateId } from 'ontime-utils';

import { event as eventDef } from '../../models/eventsDefinition.js';

import { compileMatcher, matchesRule, respellWords, splitIncludedParts, stripTitle } from './pcoRules.js';
import { localDateKey, localDayLabel, localTimeOfDayMs } from './pcoTime.js';
import type { PcoItem, PcoItemTime, PcoItemType, PcoPlan, PcoPlanTime, PcoServicePosition } from './pcoTypes.js';

/** one calendar day of a plan, in the configured timezone */
export type PcoPlanDay = {
  /** YYYY-MM-DD in the configured timezone */
  dateKey: string;
  /** human readable, eg "Sunday, 23 August" */
  label: string;
  times: PcoPlanTime[];
  serviceTimes: PcoPlanTime[];
  /**
   * The production run: soundchecks, rehearsals, production checks. Named and
   * timed by the plan, which is what the PRE section is built from.
   */
  rehearsalTimes: PcoPlanTime[];
  /**
   * Every non-service time, rehearsals included, which is what anchors a run under
   * `preAnchor: 'plan-time'`.
   *
   * What is in here and not in `rehearsalTimes` is staffing call times -- the
   * kitchen, the carpark, the producer's whole morning -- which overlap each other
   * and both services, so they never become entries.
   */
  otherTimes: PcoPlanTime[];
};

export type PcoBuildResult = {
  rundown: OntimeRundown;
  serviceProfiles: ServiceProfiles;
  warnings: string[];
  /** the day the rundown was built for */
  day: PcoPlanDay;
  /** every day the plan has times on, so a caller can offer a choice */
  availableDays: PcoPlanDay[];
};

export type PcoBuildInput = {
  plan: PcoPlan;
  planTimes: PcoPlanTime[];
  items: PcoItem[];
  itemTimes?: PcoItemTime[];
  rules: PcoRules;
  /** YYYY-MM-DD in the configured timezone; defaults to the first day holding a service time */
  targetDate?: string;
  /** which service type the plan belongs to, so its own rules are applied */
  serviceTypeId?: string;
};

/**
 * The rules as they apply to one service type: its own rules first, since first
 * match wins and the narrower scope should beat the organisation-wide one.
 *
 * Exported because the import page has to resolve an item the same way the build
 * will, or the row would show one thing and the import do another.
 */
export function scopeRulesToServiceType(rules: PcoRules, serviceTypeId?: string): PcoRules {
  const scoped = serviceTypeId ? rules.serviceTypeRules?.[serviceTypeId] : undefined;
  if (!scoped || scoped.length === 0) {
    return rules;
  }
  return { ...rules, timerRules: [...scoped, ...rules.timerRules] };
}

/* -------------------------------------------------------------------------- */
/* timezone helpers                                                            */
/* -------------------------------------------------------------------------- */

/** keeps a time of day inside a single day */
function wrapTimeOfDay(ms: number): number {
  return ((ms % dayInMs) + dayInMs) % dayInMs;
}

/* -------------------------------------------------------------------------- */
/* day grouping                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Plans often carry times on more than one date: a midweek rehearsal alongside
 * the Sunday services. An Ontime rundown is a single day, so the caller picks one.
 */
export function groupPlanTimesByDay(planTimes: PcoPlanTime[], timezone: string): PcoPlanDay[] {
  const byDay = new Map<string, PcoPlanDay>();

  const sorted = [...planTimes].sort(
    (a, b) => new Date(a.attributes.starts_at).valueOf() - new Date(b.attributes.starts_at).valueOf(),
  );

  for (const planTime of sorted) {
    if (!planTime.attributes.starts_at) {
      continue;
    }
    const dateKey = localDateKey(planTime.attributes.starts_at, timezone);
    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, {
        dateKey,
        label: localDayLabel(planTime.attributes.starts_at, timezone),
        times: [],
        serviceTimes: [],
        rehearsalTimes: [],
        otherTimes: [],
      });
    }
    const day = byDay.get(dateKey)!;
    day.times.push(planTime);
    if (planTime.attributes.time_type === 'service') {
      day.serviceTimes.push(planTime);
    } else {
      if (planTime.attributes.time_type === 'rehearsal') {
        day.rehearsalTimes.push(planTime);
      }
      day.otherTimes.push(planTime);
    }
  }

  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/* -------------------------------------------------------------------------- */
/* the production run                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The clock time a title states, as milliseconds since local midnight.
 *
 * Two moments in the morning are recorded nowhere but in the text of a heading --
 * "SERVICE BRIEFING 8:05AM", "BROADCAST BRIEF 8:10am" -- so the title is the only
 * place left to read them from. Returns null when the title states no time, which
 * is the normal case for a heading.
 *
 * Deliberately strict about the meridiem: a bare "8:05" in a title is far more
 * likely to be a duration or a date than a time of day, and reading it as one
 * would place an entry at eight in the morning on the strength of a guess.
 */
export function parseTitleTime(title: string): number | null {
  const match = /(\d{1,2})[:.](\d{2})\s*(am|pm)\b/i.exec(title);
  if (!match) {
    return null;
  }
  const minutes = Number(match[2]);
  let hours = Number(match[1]);
  if (hours > 12 || minutes > 59) {
    return null;
  }
  const isPm = match[3].toLowerCase() === 'pm';
  // 12am is midnight and 12pm is noon, so the 12 is the exception in both directions
  if (hours === 12) {
    hours = 0;
  }
  return ((hours + (isPm ? 12 : 0)) * 60 + minutes) * 60 * 1000;
}

/**
 * The title with the clock time taken out of it, which is what a derived entry is
 * called: "SERVICE BRIEFING 8:05AM" becomes "SERVICE BRIEFING", because the entry
 * now sits at 8:05 and the title repeating it is noise.
 *
 * Exported so the import page names the row the same way. A rule written from a row
 * has to match the entry the build makes, and the entry is named by this.
 */
export function titleWithoutTime(title: string): string {
  return title.replace(/(\d{1,2})[:.](\d{2})\s*(am|pm)\b/i, '').trim() || title.trim();
}

/**
 * A title the run sheet SHOUTS, given leading capitals.
 *
 * A run sheet is printed and scanned across a page; a rundown is read at a glance
 * off a timer screen, and the two do not want the same typography. Planning Center
 * headings are written in caps and the rundown does not have to be.
 *
 * Only a title that is **entirely** upper case is recased. A single lower case
 * letter anywhere means somebody cased it deliberately, and recasing that would
 * turn "EOS Announcements" into "Eos Announcements". A word glued to a digit is
 * left alone for the same reason, so "8:05AM" does not become "8:05Am".
 */
export function toLeadingCapitals(title: string): string {
  if (/\p{Ll}/u.test(title)) {
    return title;
  }
  return title.replace(/(?<![\p{L}\p{N}])\p{L}[\p{L}']*/gu, (word) => word[0] + word.slice(1).toLowerCase());
}

/** a step of the production run, before it is given a duration */
export type DerivedStep = {
  /** the plan time it came from, so the import page can key a row by it */
  id: string;
  title: string;
  note: string;
  start: number;
  /** null where only a start is known, as with a timed header */
  end: number | null;
};

/**
 * The rehearsal times of a day, as steps in clock order.
 *
 * A rundown is linear and a morning is not: the band and the vocalists rehearse in
 * different rooms at the same time. The first of any overlapping set keeps the row
 * and the rest are recorded in its note, so the clock stays true and nothing is
 * silently lost.
 *
 * Gaps are left alone. A plan that says the sync ends at 06:25 and the call time
 * starts at 06:30 means it, and the entries either side of that gap simply do not
 * link to each other.
 */
export function rehearsalSteps(times: PcoPlanTime[], timezone: string): DerivedStep[] {
  const sorted = [...times].sort((a, b) => a.attributes.starts_at.localeCompare(b.attributes.starts_at));
  const steps: DerivedStep[] = [];

  for (const time of sorted) {
    const start = localTimeOfDayMs(time.attributes.starts_at, timezone);
    const end = time.attributes.ends_at ? localTimeOfDayMs(time.attributes.ends_at, timezone) : null;
    const title = time.attributes.name?.trim() || 'Rehearsal';

    // a step still running when this one starts is running alongside it
    const running = steps.at(-1);
    if (running && running.end !== null && start < running.end) {
      running.note = running.note ? `${running.note}\n${title}` : title;
      continue;
    }

    steps.push({ id: time.id, title, note: '', start, end });
  }

  return steps;
}

/* -------------------------------------------------------------------------- */
/* folding a section                                                           */
/* -------------------------------------------------------------------------- */

/** one fold: the item that opens it, and everything it swallows */
export type SectionFold = {
  title: string;
  rule: PcoCollapseRule;
  /** in run sheet order, the opening item first */
  members: PcoItem[];
};

export type SectionFolds = {
  /** item id -> the fold it opens */
  opens: Map<string, SectionFold>;
  /** item ids a fold swallows, which never become entries of their own */
  swallowed: Set<string>;
};

/**
 * Which items each fold takes, for one `service_position` group in sequence order.
 *
 * Shared by the builder and the import page, because a row that says "folded in
 * with its section" has to be one the build will actually fold. The two used to
 * disagree: nothing knew the section's shape but the builder.
 *
 * A section runs from the matched item to the item before the next heading, which
 * is how Planning Center delimits one. `membersMatch` then decides how much of it
 * folds -- and only **consecutive** matches fold together, so a set that goes
 * songs, MC moment, songs stays in that order instead of becoming one block and a
 * moment that has moved. A second run is named "... (cont.)".
 */
export function planSectionFolds(sectionItems: PcoItem[], rules: PcoRules): SectionFolds {
  const opens = new Map<string, SectionFold>();
  const swallowed = new Set<string>();
  const titleOf = (item: PcoItem): string => {
    const stripped = stripTitle(item.attributes.title ?? '', rules.titleStrip);
    return respellWords(rules.normaliseTitleCase ? toLeadingCapitals(stripped) : stripped, rules.titleWords);
  };

  for (let index = 0; index < sectionItems.length; index++) {
    const opener = sectionItems[index];
    const rule = rules.collapseSections.find((candidate) => matchesRule(candidate.match, itemCandidate(opener)));
    if (!rule) {
      continue;
    }

    const members: PcoItem[] = [];
    while (index + 1 < sectionItems.length && sectionItems[index + 1].attributes.item_type !== 'header') {
      index += 1;
      members.push(sectionItems[index]);
    }

    // a fold whose opening heading was asked to be left out takes nothing with it
    if (resolveEffectFor(itemCandidate(opener), rules).effect.importAs === 'omit') {
      continue;
    }

    const base = rule.title?.trim() || titleOf(opener);

    if (!rule.membersMatch) {
      opens.set(opener.id, { title: base, rule, members: [opener, ...members] });
      members.forEach((member) => swallowed.add(member.id));
      continue;
    }

    let run: PcoItem[] = [];
    let ordinal = 0;
    const flush = () => {
      // a run holding nothing but the opening heading folded nothing, so it is not a
      // fold at all -- the heading goes back to following `headersBecome`
      if (run.filter((entry) => entry !== opener).length === 0) {
        run = [];
        return;
      }
      opens.set(run[0].id, { title: ordinal === 0 ? base : `${base} (cont.)`, rule, members: run });
      run.slice(1).forEach((member) => swallowed.add(member.id));
      ordinal += 1;
      run = [];
    };

    for (const entry of [opener, ...members]) {
      /**
       * A row asked for explicitly is never folded away. That is what makes the
       * import page's "Import as" mean something on a member of a section: choosing
       * "Timed event" on a song has to take it out of the block and give it a cue.
       */
      const chosen = entry !== opener && resolveEffectFor(itemCandidate(entry), rules).effect.importAs !== undefined;

      if (!chosen && (entry === opener || matchesRule(rule.membersMatch, itemCandidate(entry)))) {
        run.push(entry);
      } else {
        flush();
      }
    }
    flush();
  }

  return { opens, swallowed };
}

/* -------------------------------------------------------------------------- */
/* item -> event                                                               */
/* -------------------------------------------------------------------------- */

function itemCandidate(item: PcoItem) {
  return {
    title: item.attributes.title ?? '',
    itemType: item.attributes.item_type,
    servicePosition: item.attributes.service_position,
  };
}

/**
 * The default effect, without a rename.
 *
 * A rename says something about one item. Left in `defaultEffect` it would retitle
 * every event in the rundown, so it is dropped here rather than trusted.
 */
function baseEffect(rules: PcoRules): PcoRuleEffect {
  const { title: _renamesEverything, ...rest } = rules.defaultEffect;
  return rest;
}

/**
 * Default effect, then the first matching rule on top.
 *
 * Exported because the import page has to resolve a row exactly as the build will,
 * or a control would show one thing and the import do another.
 */
export function resolveEffectFor(
  candidate: { title: string; itemType: PcoItemType; servicePosition: PcoServicePosition },
  rules: PcoRules,
): { effect: PcoRuleEffect; ruleName: string | null } {
  for (const rule of rules.timerRules) {
    if (matchesRule(rule.match, candidate)) {
      return { effect: { ...baseEffect(rules), ...rule.effect }, ruleName: rule.name };
    }
  }
  return { effect: baseEffect(rules), ruleName: null };
}

function resolveEffect(item: PcoItem, rules: PcoRules): { effect: PcoRuleEffect; ruleName: string | null } {
  return resolveEffectFor(itemCandidate(item), rules);
}

/**
 * A derived step has no PCO item behind it, but a rule should still be able to
 * reach it: the settings panel writes rules by title, and the production run is
 * where hide-timer and aux-timer are most likely to be wanted.
 */
function resolveDerivedEffect(title: string, rules: PcoRules): PcoRuleEffect {
  return resolveEffectFor({ title, itemType: 'item', servicePosition: 'pre' }, rules).effect;
}

function applyEffect(event: OntimeEvent, effect: PcoRuleEffect): OntimeEvent {
  const next = { ...event };
  if (effect.title !== undefined) next.title = effect.title;
  if (effect.timerType !== undefined) next.timerType = effect.timerType as TimerType;
  if (effect.countToEnd !== undefined) next.countToEnd = effect.countToEnd;
  if (effect.timeStrategy !== undefined) next.timeStrategy = effect.timeStrategy as TimeStrategy;
  if (effect.endAction !== undefined) next.endAction = effect.endAction;
  if (effect.colour !== undefined) next.colour = effect.colour;
  if (effect.isPublic !== undefined) next.isPublic = effect.isPublic;
  if (effect.skip !== undefined) next.skip = effect.skip;
  if (effect.hideTimer !== undefined) next.hideTimer = effect.hideTimer;
  if (effect.showAsAuxTimer !== undefined) next.showAsAuxTimer = effect.showAsAuxTimer;
  return next;
}

function makeEvent(args: {
  title: string;
  note: string;
  timeStart: number;
  duration: number;
  effect: PcoRuleEffect;
}): OntimeEvent {
  const timeStart = wrapTimeOfDay(args.timeStart);
  const base: OntimeEvent = {
    ...eventDef,
    id: generateId(),
    cue: '',
    title: args.title,
    note: args.note,
    timeStart,
    duration: args.duration,
    timeEnd: wrapTimeOfDay(timeStart + args.duration),
  };
  return applyEffect(base, args.effect);
}

/* -------------------------------------------------------------------------- */
/* per-service exclusions                                                     */
/* -------------------------------------------------------------------------- */

/**
 * PCO expresses "this item is only in the 9am" with an ItemTime carrying
 * `exclude: true` for the other service time. Plans lean on this: a single
 * "Doors Open" is often two items, one per service, each excluded from the other.
 */
export type ExclusionLookup = {
  isExcludedFrom: (itemId: string, planTimeId: string) => boolean;
  lengthOverride: (itemId: string, planTimeId: string) => number | null;
};

export function buildExclusionLookup(itemTimes: PcoItemTime[]): ExclusionLookup {
  const byPair = new Map<string, PcoItemTime>();
  for (const itemTime of itemTimes) {
    const itemId = (itemTime.relationships?.item?.data as { id: string } | undefined)?.id;
    const planTimeId = (itemTime.relationships?.plan_time?.data as { id: string } | undefined)?.id;
    if (itemId && planTimeId) {
      byPair.set(`${itemId}:${planTimeId}`, itemTime);
    }
  }

  return {
    isExcludedFrom: (itemId, planTimeId) => byPair.get(`${itemId}:${planTimeId}`)?.attributes.exclude === true,
    lengthOverride: (itemId, planTimeId) => {
      const found = byPair.get(`${itemId}:${planTimeId}`);
      const length = found?.attributes.length;
      return length === null || length === undefined ? null : length;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* what the mirror cannot represent                                           */
/* -------------------------------------------------------------------------- */

/**
 * The offset mirror assumes the second service is the first shifted in time.
 * PCO can say otherwise, and we surface it rather than silently flattening it.
 *
 * Only the master section is mirrored, so `mirroredItemIds` limits the report to
 * items that actually get cloned -- a PRE item excluded from the 11am is fine,
 * because PRE runs once and is never duplicated. Exclusions on the MASTER time
 * are not reported either: those items were already dropped from the rundown.
 */
export function findDivergence(
  items: PcoItem[],
  itemTimes: PcoItemTime[],
  serviceTimes: PcoPlanTime[],
  mirroredItemIds?: Set<string>,
): string[] {
  if (itemTimes.length === 0 || serviceTimes.length < 2) {
    return [];
  }

  const masterTimeId = serviceTimes[0].id;
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const mirroredNames = new Map(
    serviceTimes.slice(1).map((time) => [time.id, time.attributes.name || time.attributes.starts_at]),
  );
  const warnings: string[] = [];

  for (const itemTime of itemTimes) {
    const planTimeId = (itemTime.relationships?.plan_time?.data as { id: string } | undefined)?.id;
    const itemId = (itemTime.relationships?.item?.data as { id: string } | undefined)?.id;

    if (!planTimeId || planTimeId === masterTimeId || !mirroredNames.has(planTimeId)) {
      continue;
    }
    if (!itemId || (mirroredItemIds && !mirroredItemIds.has(itemId))) {
      continue;
    }

    const item = itemsById.get(itemId);
    if (!item) {
      continue;
    }
    const itemTitle = item.attributes.title ?? `item ${itemId}`;
    const serviceName = mirroredNames.get(planTimeId);

    if (itemTime.attributes.exclude === true) {
      warnings.push(
        `"${itemTitle}" is excluded from the ${serviceName} service in Planning Center, but the mirror will still include it.`,
      );
    }
    const overrideLength = itemTime.attributes.length;
    if (overrideLength !== null && overrideLength !== undefined && overrideLength !== item.attributes.length) {
      warnings.push(
        `"${itemTitle}" is ${overrideLength}s in the ${serviceName} service but ${item.attributes.length}s on the plan. The mirror uses the plan length.`,
      );
    }
    if (itemTime.attributes.length_offset) {
      warnings.push(
        `"${itemTitle}" has a ${itemTime.attributes.length_offset}s length offset in the ${serviceName} service, which the mirror ignores.`,
      );
    }
  }

  return warnings;
}

/* -------------------------------------------------------------------------- */
/* the build                                                                   */
/* -------------------------------------------------------------------------- */

export function buildRundownFromPlan(input: PcoBuildInput): PcoBuildResult {
  const { plan, planTimes, items, itemTimes = [], targetDate } = input;
  const rules = scopeRulesToServiceType(input.rules, input.serviceTypeId);
  const warnings: string[] = [];

  const availableDays = groupPlanTimesByDay(planTimes, rules.timezone);
  if (availableDays.length === 0) {
    throw new Error('This Planning Center plan has no times, so there is nothing to build a rundown from.');
  }

  // pick the day: the requested one, else the first that actually holds a service
  let day = targetDate ? availableDays.find((candidate) => candidate.dateKey === targetDate) : undefined;
  if (targetDate && !day) {
    throw new Error(
      `The plan has no times on ${targetDate}. Available days: ${availableDays.map((d) => d.dateKey).join(', ')}`,
    );
  }
  if (!day) {
    day = availableDays.find((candidate) => candidate.serviceTimes.length > 0) ?? availableDays[0];
  }

  if (availableDays.length > 1) {
    warnings.push(
      `This plan has times on ${availableDays.length} days (${availableDays
        .map((d) => d.dateKey)
        .join(', ')}). Building for ${day.dateKey}.`,
    );
  }

  if (day.serviceTimes.length === 0) {
    throw new Error(`${day.dateKey} has no service times on this plan, only ${day.otherTimes.length} other time(s).`);
  }

  /* --- services and offsets ------------------------------------------------ */

  const masterTime = day.serviceTimes[0];
  const masterStartAbs = new Date(masterTime.attributes.starts_at).valueOf();
  const masterStartOfDay = localTimeOfDayMs(masterTime.attributes.starts_at, rules.timezone);

  const services: ServiceProfiles['services'] = day.serviceTimes.map((planTime, index) => ({
    id: generateId(),
    name: rules.serviceNames[index] ?? planTime.attributes.name ?? `Service ${index + 1}`,
    offset: new Date(planTime.attributes.starts_at).valueOf() - masterStartAbs,
  }));

  if (services.length === 1) {
    warnings.push('Only one service time on this day, so no mirrored service was configured.');
  }

  /* --- filter items -------------------------------------------------------- */

  const exclusions = buildExclusionLookup(itemTimes);
  const ordered = [...items].sort((a, b) => (a.attributes.sequence ?? 0) - (b.attributes.sequence ?? 0));

  // items PCO excludes from the master belong to another service; keeping them
  // would put them in the master AND have the mirror duplicate them
  const droppedForMaster: string[] = [];
  const kept = ordered.filter((item) => {
    if (rules.respectMasterExclusions && exclusions.isExcludedFrom(item.id, masterTime.id)) {
      droppedForMaster.push(item.attributes.title ?? item.id);
      return false;
    }
    return true;
  });

  if (droppedForMaster.length > 0) {
    warnings.push(
      `Excluded from the ${services[0].name} service in Planning Center, so left out of the master: ` +
        `${droppedForMaster.map((title) => `"${title}"`).join(', ')}. The mirror regenerates the other service.`,
    );
  }

  /* --- items -> entries-to-be ----------------------------------------------
   * Not one entry per item. A section can be folded into a single event, an item
   * can hand its length to the one above it, and a heading can be dropped. All of
   * that is resolved here, while the run sheet's own structure is still visible,
   * so that laying out the times is only ever "take each length in turn".
   *
   * An item is claimed by the first of these that matches it: a section fold, a
   * merge into the entry above, then the ignore list.
   */

  type BuildUnit = {
    title: string;
    note: string;
    duration: number;
    effect: PcoRuleEffect;
    /** a divider rather than a timed entry */
    isBlock: boolean;
    /** every item this accounts for, which is what scopes the divergence report */
    itemIds: string[];
  };

  const durationOf = (item: PcoItem): number => Math.max(0, (item.attributes.length ?? 0) * 1000);
  const titleOf = (item: PcoItem): string => {
    const stripped = stripTitle(item.attributes.title ?? '', rules.titleStrip);
    return respellWords(rules.normaliseTitleCase ? toLeadingCapitals(stripped) : stripped, rules.titleWords);
  };
  const matchesAny = (matches: PcoRuleMatch[], item: PcoItem): boolean =>
    matches.some((match) => matchesRule(match, itemCandidate(item)));

  const zeroLength: string[] = [];
  const strandedMerges: string[] = [];
  /** items folded into the entry above them, which the divergence report leaves alone */
  const mergedItemIds = new Set<string>();
  /** generated entry id -> the PCO items behind it */
  const entryToItems = new Map<string, string[]>();

  const toUnits = (sectionItems: PcoItem[]): BuildUnit[] => {
    const units: BuildUnit[] = [];
    const folds = planSectionFolds(sectionItems, rules);

    for (let index = 0; index < sectionItems.length; index++) {
      const item = sectionItems[index];

      const fold = folds.opens.get(item.id);
      if (fold) {
        units.push({
          title: fold.title,
          // the set list is the entire content of the fold, and folding it away
          // silently is the one thing the person calling the show cannot undo
          note:
            fold.rule.listContents === false
              ? ''
              : fold.members
                  .filter((member) => member.attributes.item_type !== 'header')
                  .map(titleOf)
                  .filter(Boolean)
                  .join('\n'),
          duration: fold.members.reduce((total, member) => total + durationOf(member), 0),
          effect: { ...resolveEffect(item, rules).effect, ...fold.rule.effect },
          isBlock: false,
          itemIds: fold.members.map((member) => member.id),
        });
        continue;
      }

      // swallowed by a fold above, so it never takes a row of its own
      if (folds.swallowed.has(item.id)) {
        continue;
      }

      /**
       * Resolved before the merge and ignore lists are consulted, because a choice
       * made on the import page's row beats them: nothing on a run sheet should be
       * out of reach of its own row.
       */
      const effect = resolveEffect(item, rules).effect;
      const chosen = effect.importAs !== undefined;

      if (!chosen && matchesAny(rules.mergeIntoPrevious, item)) {
        const previous = units.at(-1);
        if (previous && !previous.isBlock) {
          previous.duration += durationOf(item);
          previous.itemIds.push(item.id);
          mergedItemIds.add(item.id);
          continue;
        }
        // nothing above it to give the time to, so it keeps a row of its own
        strandedMerges.push(titleOf(item) || 'untitled');
      } else if (!chosen && matchesAny(rules.ignoreItems, item)) {
        continue;
      }

      const isHeader = item.attributes.item_type === 'header';
      const servicePosition = item.attributes.service_position;

      if (effect.importAs === 'omit') {
        continue;
      }
      if (!effect.importAs && isHeader && rules.headersBecome === 'nothing') {
        continue;
      }

      /**
       * An item listing what it includes becomes one entry per thing. The first
       * keeps the whole length; the rest are placeholders at nothing, for whoever is
       * calling the show to give a time to on the day or delete when the week does
       * not need them.
       */
      const split = splitIncludedParts(titleOf(item), rules.splitIncluded);

      units.push({
        title: split.title,
        note: item.attributes.description ?? '',
        duration: durationOf(item),
        effect,
        isBlock: effect.importAs ? effect.importAs === 'block' : isHeader && rules.headersBecome === 'block',
        itemIds: [item.id],
      });

      for (const part of split.parts) {
        units.push({
          title: part,
          note: '',
          duration: 0,
          // resolved by title like any entry, so a rule can reach "Altar Call"
          effect: resolveEffectFor({ title: part, itemType: 'item', servicePosition }, rules).effect,
          isBlock: false,
          // no item of its own: the divergence report describes the row it came from
          itemIds: [],
        });
      }
    }

    return units;
  };

  /* --- times ---------------------------------------------------------------
   * Planning Center places items by service_position, not by one running total:
   *   'pre'    back-times as a contiguous run ENDING at the service start
   *   'during' accumulates forward FROM the service start
   *   'post'   continues after the last `during` item
   * Sequence order already groups them this way, so laying each group out and
   * concatenating preserves the run sheet's order.
   */

  type Positioned = { sortKey: number; entry: OntimeRundownEntry };

  const layOutUnits = (units: BuildUnit[], start: number): { entries: Positioned[]; end: number } => {
    const entries: Positioned[] = [];
    let cursor = start;

    for (const unit of units) {
      if (unit.isBlock) {
        // a divider, not a timed entry -- but its length still shifts what follows
        const block: OntimeBlock = { type: SupportedEvent.Block, id: generateId(), title: unit.title };
        entryToItems.set(block.id, unit.itemIds);
        entries.push({ sortKey: cursor, entry: block });
        cursor += unit.duration;
        continue;
      }

      if (unit.duration === 0) {
        zeroLength.push(unit.title || 'untitled');
      }
      const event = makeEvent({
        title: unit.title,
        note: unit.note,
        timeStart: cursor,
        duration: unit.duration,
        effect: unit.effect,
      });
      entryToItems.set(event.id, unit.itemIds);
      entries.push({ sortKey: cursor, entry: event });
      cursor += unit.duration;
    }

    return { entries, end: cursor };
  };

  /* --- the production run, read off the plan -------------------------------
   * The morning above the run sheet is in the plan twice removed: as `rehearsal`
   * times carrying their own names and clock times, and as headers that state a
   * time in their title and nowhere else.
   *
   * The headers have to be taken out of the item pipeline as well as read here.
   * They sit in `during`, so left where they are they would lay out forward from
   * the service start and land at 9:00 announcing a briefing that happened at 8:05.
   */

  const derivedSteps: DerivedStep[] = rules.deriveRehearsalTimes
    ? rehearsalSteps(day.rehearsalTimes, rules.timezone)
    : [];

  const timedHeaderIds = new Set<string>();
  if (rules.deriveTimedHeaders) {
    for (const item of kept) {
      // a header carrying length would shift the service if it were pulled out of
      // the run, so only the lengthless ones -- which is all of them in practice
      if (item.attributes.item_type !== 'header' || item.attributes.length) {
        continue;
      }
      const stated = parseTitleTime(item.attributes.title ?? '');
      if (stated === null || stated >= masterStartOfDay) {
        continue;
      }
      timedHeaderIds.add(item.id);
      // the time was the title's only reason for carrying it; the entry sits there now
      /**
       * Cased again after the time comes off. "BROADCAST BRIEF 8:10am" is not an
       * all-caps title while it still carries a lower case meridiem, so the first
       * pass leaves it alone and only this one sees it for what it is.
       */
      const withoutTime = titleWithoutTime(titleOf(item));
      const title = respellWords(
        rules.normaliseTitleCase ? toLeadingCapitals(withoutTime) : withoutTime,
        rules.titleWords,
      );
      derivedSteps.push({ id: item.id, title, note: '', start: stated, end: null });
    }
  }

  derivedSteps.sort((a, b) => a.start - b.start);

  const unitsInPosition = (position: PcoItem['attributes']['service_position']): BuildUnit[] =>
    toUnits(kept.filter((item) => item.attributes.service_position === position && !timedHeaderIds.has(item.id)));

  const preUnits = unitsInPosition('pre');
  const duringUnits = unitsInPosition('during');
  const postUnits = unitsInPosition('post');

  if (preUnits.length + duringUnits.length + postUnits.length === 0) {
    warnings.push('No items survived the filters; the rundown will only contain inferred entries.');
  }

  // where the pre-service run begins
  const preTotal = preUnits.reduce((total, unit) => total + unit.duration, 0);
  /**
   * A rehearsal time that has become an entry of its own cannot also be what the
   * run sheet hangs off: anchoring doors to the 06:15 sync would drag the morning
   * on top of the production run it sits after.
   */
  const preAnchorTime = day.otherTimes.find(
    (time) => !(rules.deriveRehearsalTimes && time.attributes.time_type === 'rehearsal'),
  );
  let preStartOfDay: number;

  if (rules.preAnchor === 'plan-time' && preAnchorTime) {
    preStartOfDay = localTimeOfDayMs(preAnchorTime.attributes.starts_at, rules.timezone);
  } else {
    preStartOfDay = masterStartOfDay - preTotal;
  }

  const pre = layOutUnits(preUnits, preStartOfDay);
  const during = layOutUnits(duringUnits, masterStartOfDay);
  const post = layOutUnits(postUnits, during.end);
  const serviceEndOfDay = post.end;

  if (rules.preAnchor === 'plan-time' && preUnits.length > 0 && pre.end !== masterStartOfDay) {
    // back-timing makes this true by construction; anchoring to a plan time does not
    warnings.push('The pre-service items do not add up to the service start; check the lengths in Planning Center.');
  }
  if (strandedMerges.length > 0) {
    warnings.push(
      `Nothing above them to merge into, so imported on their own: ` +
        `${strandedMerges.map((title) => `"${title}"`).join(', ')}.`,
    );
  }
  if (zeroLength.length > 0) {
    warnings.push(`No length in Planning Center, imported as 0:00: ${zeroLength.map((t) => `"${t}"`).join(', ')}.`);
  }

  /* --- split PRE from the master section ----------------------------------- */

  const allPositioned = [...pre.entries, ...during.entries, ...post.entries];

  // PRE runs from the top of the plan up to and including the boundary entry
  const boundaryMatcher = compileMatcher(rules.preBoundaryTitleMatch);
  let preEndIndex = -1;
  if (boundaryMatcher) {
    for (let i = allPositioned.length - 1; i >= 0; i--) {
      const entry = allPositioned[i].entry;
      const title = 'title' in entry ? entry.title : '';
      if (boundaryMatcher.test(title)) {
        preEndIndex = i;
        break;
      }
    }
  }
  if (preEndIndex === -1 && rules.preBoundaryTitleMatch) {
    warnings.push(
      `No item matched the PRE boundary /${rules.preBoundaryTitleMatch}/i, so every item was treated as part of the service section.`,
    );
  }

  const preSection = allPositioned.slice(0, preEndIndex + 1);
  const serviceSection = allPositioned.slice(preEndIndex + 1);

  /* --- the production run becomes entries ----------------------------------
   * Each step runs until the plan says it ends, and a step the plan only gave a
   * start to runs until whatever happens next -- the last of them handing over to
   * the run sheet's own first item. So the briefing is five minutes because the
   * broadcast brief follows it, and the broadcast brief is ten because the prayer
   * meeting back-times to 8:20.
   */

  const derivedEntries: Positioned[] = [];
  const runHandsOverAt = preSection.length > 0 ? preSection[0].sortKey : preStartOfDay;

  for (let index = 0; index < derivedSteps.length; index++) {
    const step = derivedSteps[index];
    /**
     * The end is taken before anything is dropped, so leaving a step out removes a
     * row and leaves a gap rather than stretching the one above it over the hole.
     */
    const nextStart = derivedSteps[index + 1]?.start ?? runHandsOverAt;
    const end = step.end ?? nextStart;
    const duration = Math.max(0, end - step.start);

    // a production step takes the same per-row choices as a run sheet item
    const effect = resolveDerivedEffect(step.title, rules);
    if (effect.importAs === 'omit') {
      continue;
    }
    if (effect.importAs === 'block') {
      derivedEntries.push({
        sortKey: step.start,
        entry: { type: SupportedEvent.Block, id: generateId(), title: step.title },
      });
      continue;
    }

    if (duration === 0) {
      warnings.push(`Nothing follows "${step.title}" in the plan, so it was imported as 0:00.`);
    }

    derivedEntries.push({
      sortKey: step.start,
      entry: makeEvent({ title: step.title, note: step.note, timeStart: step.start, duration, effect }),
    });
  }

  /**
   * The lead-in is the one entry of the morning still stated rather than read:
   * powering the building on is not something Planning Center records. It ends
   * where the first derived step starts, so it moves when the plan moves.
   */
  if (rules.leadIn && derivedSteps.length > 0) {
    const start = derivedSteps[0].start - rules.leadIn.duration;
    const effect = { ...resolveDerivedEffect(rules.leadIn.title, rules), ...rules.leadIn.effect };

    if (effect.importAs !== 'omit') {
      derivedEntries.unshift({
        sortKey: start,
        entry: makeEvent({
          title: rules.leadIn.title,
          note: '',
          timeStart: start,
          duration: rules.leadIn.duration,
          effect,
        }),
      });
    }
  }

  if (rules.deriveRehearsalTimes && day.rehearsalTimes.length === 0) {
    warnings.push(
      'This plan has no rehearsal times on the chosen day, so the rundown starts at the run sheet rather than at the production run.',
    );
  }

  // already in clock order, and every one of them sits ahead of the run sheet
  preSection.unshift(...derivedEntries);

  /* --- inferred entries ---------------------------------------------------- */

  const anchors: Record<PcoInferredEntry['anchor'], number> = {
    'pre-start': preStartOfDay,
    'service-start': masterStartOfDay,
    'service-end': serviceEndOfDay,
  };

  for (const inferred of rules.inferredEntries) {
    const anchor = anchors[inferred.anchor];
    if (anchor === undefined) {
      warnings.push(`Inferred entry "${inferred.name}" has an unknown anchor "${inferred.anchor}" and was skipped.`);
      continue;
    }
    const timeStart = anchor + inferred.offset;
    const positioned: Positioned = {
      sortKey: timeStart,
      entry: makeEvent({
        title: inferred.title,
        note: '',
        timeStart,
        duration: inferred.duration,
        effect: { ...baseEffect(rules), ...inferred.effect },
      }),
    };

    const target = inferred.section === 'pre' ? preSection : serviceSection;
    // keep each section in clock order; ties land after what is already there
    const at = target.findIndex((existing) => existing.sortKey > positioned.sortKey);
    if (at === -1) {
      target.push(positioned);
    } else {
      target.splice(at, 0, positioned);
    }
  }

  /* --- what an overrun does to the rest of a section ------------------------
   * The message is a fixed-duration countdown, so it can overrun. Anything after
   * it counting down to a wall clock time would absorb that overrun and shrink --
   * a two minute announcement quietly becoming thirty seconds. So once a section
   * holds something that can move what follows, what follows keeps its own length
   * and moves instead.
   *
   * Per section: PRE is its own run, and the mirror clones the master, so a
   * section always starts where the run sheet says it starts.
   */

  if (rules.fixedDurationCarriesForward) {
    for (const section of [preSection, serviceSection]) {
      let holding = false;
      for (const { entry } of section) {
        if (!isOntimeEvent(entry)) {
          continue;
        }
        if (holding) {
          entry.timerType = TimerType.CountDown;
          entry.countToEnd = false;
          entry.timeStrategy = TimeStrategy.LockDuration;
        } else if (entry.countToEnd === false) {
          holding = true;
        }
      }
    }
  }

  /* --- assemble ------------------------------------------------------------ */

  const boundaryBlock: OntimeBlock = {
    type: SupportedEvent.Block,
    id: generateId(),
    title: services[0].name,
  };

  const rundown: OntimeRundown = [
    ...preSection.map(({ entry }) => entry),
    boundaryBlock,
    ...serviceSection.map(({ entry }) => entry),
  ];

  // cue numbers and links are positional, so they wait until the order is final
  let cueNumber = 1;
  let previousEvent: OntimeEvent | null = null;

  for (const entry of rundown) {
    if (!isOntimeEvent(entry)) {
      continue;
    }
    entry.cue = String(cueNumber++);

    /**
     * Every entry is linked to the one above it, which is what makes the rundown
     * move as one when something runs long.
     *
     * Only where the times already meet, so a link records the relationship the
     * run sheet already has rather than changing a time: the first entry of the
     * morning has nothing above it, and a gap -- which `preAnchor: 'plan-time'`
     * can leave -- is a gap for a reason.
     *
     * The mirrored service's first entry ends up unlinked without anything here:
     * its link points outside the mirrored section, and `regenerateInstances`
     * drops those rather than dragging the section back to the master's end.
     */
    entry.linkStart = previousEvent && previousEvent.timeEnd === entry.timeStart ? previousEvent.id : null;
    previousEvent = entry;
  }

  /* --- what the mirror cannot represent ------------------------------------ */

  /**
   * Only the master section gets mirrored, so PRE divergence is harmless.
   *
   * Merged items are left out as well. The plan shape that makes merging useful is
   * the one where PCO holds a separate item per service -- the 9am doors plus the
   * online message it carries, and an 11am doors a minute longer to match. There,
   * reporting the online message's exclusion says the mirror is wrong when the
   * mirror's total is exactly right, and the item it merged into is reported on its
   * own merits anyway.
   */
  const mirroredItemIds = new Set(
    serviceSection
      .flatMap(({ entry }) => entryToItems.get(entry.id) ?? [])
      .filter((itemId) => !mergedItemIds.has(itemId)),
  );

  warnings.push(...findDivergence(kept, itemTimes, day.serviceTimes, mirroredItemIds));

  const planLabel = plan.attributes.title || plan.attributes.dates || plan.id;
  warnings.unshift(
    `Built ${preSection.length} PRE and ${serviceSection.length} service entries from plan "${planLabel}".`,
  );

  return {
    rundown,
    serviceProfiles: { boundaryBlockId: boundaryBlock.id, services },
    warnings,
    day,
    availableDays,
  };
}

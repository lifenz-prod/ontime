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

import { compileMatcher, matchesRule, type PcoInferredEntry, type PcoRuleEffect, type PcoRules } from './pcoRules.js';
import type { PcoItem, PcoItemTime, PcoPlan, PcoPlanTime } from './pcoTypes.js';

/** one calendar day of a plan, in the configured timezone */
export type PcoPlanDay = {
  /** YYYY-MM-DD in the configured timezone */
  dateKey: string;
  /** human readable, eg "Sunday, 23 August" */
  label: string;
  times: PcoPlanTime[];
  serviceTimes: PcoPlanTime[];
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
};

/* -------------------------------------------------------------------------- */
/* timezone helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * PCO timestamps are UTC. Ontime works in local time of day. Both conversions
 * go through Intl so the org's timezone is honoured without a date library.
 */
function zonedParts(iso: string, timezone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(new Date(iso))) {
    parts[type] = value;
  }
  return parts;
}

export function localDateKey(iso: string, timezone: string): string {
  const { year, month, day } = zonedParts(iso, timezone);
  return `${year}-${month}-${day}`;
}

export function localTimeOfDayMs(iso: string, timezone: string): number {
  const { hour, minute, second } = zonedParts(iso, timezone);
  // Intl renders midnight as "24" in some locales
  const hours = Number(hour) % 24;
  return ((hours * 60 + Number(minute)) * 60 + Number(second)) * 1000;
}

function localDayLabel(iso: string, timezone: string): string {
  const { weekday, day, month, year } = zonedParts(iso, timezone);
  const monthName = new Intl.DateTimeFormat('en-NZ', { timeZone: timezone, month: 'long' }).format(new Date(iso));
  return `${weekday}, ${Number(day)} ${monthName} ${year} (${year}-${month}-${day})`;
}

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
        otherTimes: [],
      });
    }
    const day = byDay.get(dateKey)!;
    day.times.push(planTime);
    if (planTime.attributes.time_type === 'service') {
      day.serviceTimes.push(planTime);
    } else {
      day.otherTimes.push(planTime);
    }
  }

  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
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

/** default effect, then the first matching rule on top */
function resolveEffect(item: PcoItem, rules: PcoRules): { effect: PcoRuleEffect; ruleName: string | null } {
  const candidate = itemCandidate(item);
  for (const rule of rules.timerRules) {
    if (matchesRule(rule.match, candidate)) {
      return { effect: { ...rules.defaultEffect, ...rule.effect }, ruleName: rule.name };
    }
  }
  return { effect: { ...rules.defaultEffect }, ruleName: null };
}

function applyEffect(event: OntimeEvent, effect: PcoRuleEffect): OntimeEvent {
  const next = { ...event };
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
  const { plan, planTimes, items, itemTimes = [], rules, targetDate } = input;
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

  const afterIgnores = ordered.filter(
    (item) => !rules.ignoreItems.some((rule) => matchesRule(rule, itemCandidate(item))),
  );

  // items PCO excludes from the master belong to another service; keeping them
  // would put them in the master AND have the mirror duplicate them
  const droppedForMaster: string[] = [];
  const kept = afterIgnores.filter((item) => {
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
  if (kept.length === 0) {
    warnings.push('No items survived the filters; the rundown will only contain inferred entries.');
  }

  /* --- times ---------------------------------------------------------------
   * Planning Center places items by service_position, not by one running total:
   *   'pre'    back-times as a contiguous run ENDING at the service start
   *   'during' accumulates forward FROM the service start
   *   'post'   continues after the last `during` item
   * Sequence order already groups them this way, so laying each group out and
   * concatenating preserves the run sheet's order.
   */

  type Positioned = { sortKey: number; entry: OntimeRundownEntry };

  const durationOf = (item: PcoItem): number => Math.max(0, (item.attributes.length ?? 0) * 1000);
  const isHeaderBlock = (item: PcoItem): boolean => rules.headersAsBlocks && item.attributes.item_type === 'header';
  const stripper = compileMatcher(rules.titleStrip);
  const titleOf = (item: PcoItem): string => {
    const raw = item.attributes.title ?? '';
    return stripper ? raw.replace(stripper, '').trim() : raw;
  };

  const zeroLength: string[] = [];
  /** generated entry id -> the PCO item it came from, used to scope divergence warnings */
  const entryToItem = new Map<string, string>();

  const layOutItems = (sectionItems: PcoItem[], start: number): { entries: Positioned[]; end: number } => {
    const entries: Positioned[] = [];
    let cursor = start;

    for (const item of sectionItems) {
      const duration = durationOf(item);
      const title = titleOf(item);

      if (isHeaderBlock(item)) {
        // a divider, not a timed entry -- but its length still shifts what follows
        const block: OntimeBlock = { type: SupportedEvent.Block, id: generateId(), title };
        entryToItem.set(block.id, item.id);
        entries.push({ sortKey: cursor, entry: block });
        cursor += duration;
        continue;
      }

      if (duration === 0) {
        zeroLength.push(title || 'untitled');
      }
      const { effect } = resolveEffect(item, rules);
      const event = makeEvent({
        title,
        note: item.attributes.description ?? '',
        timeStart: cursor,
        duration,
        effect,
      });
      entryToItem.set(event.id, item.id);
      entries.push({ sortKey: cursor, entry: event });
      cursor += duration;
    }

    return { entries, end: cursor };
  };

  const inPosition = (position: PcoItem['attributes']['service_position']) =>
    kept.filter((item) => item.attributes.service_position === position);

  const preItems = inPosition('pre');
  const duringItems = inPosition('during');
  const postItems = inPosition('post');

  // where the pre-service run begins
  const preTotal = preItems.reduce((total, item) => total + durationOf(item), 0);
  const preAnchorTime = day.otherTimes[0];
  let preStartOfDay: number;

  if (rules.preAnchor === 'plan-time' && preAnchorTime) {
    preStartOfDay = localTimeOfDayMs(preAnchorTime.attributes.starts_at, rules.timezone);
  } else {
    preStartOfDay = masterStartOfDay - preTotal;
  }

  const pre = layOutItems(preItems, preStartOfDay);
  const during = layOutItems(duringItems, masterStartOfDay);
  const post = layOutItems(postItems, during.end);
  const serviceEndOfDay = post.end;

  if (rules.preAnchor === 'back-from-service' && preItems.length > 0) {
    // a sanity check the sheet itself can be measured against
    const lastPre = pre.entries[pre.entries.length - 1];
    if (lastPre && lastPre.sortKey + durationOf(preItems[preItems.length - 1]) !== masterStartOfDay) {
      warnings.push('The pre-service items do not add up to the service start; check the lengths in Planning Center.');
    }
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
  if (preEndIndex === -1) {
    warnings.push(
      `No item matched the PRE boundary /${rules.preBoundaryTitleMatch}/i, so every item was treated as part of the service section.`,
    );
  }

  const preSection = allPositioned.slice(0, preEndIndex + 1);
  const serviceSection = allPositioned.slice(preEndIndex + 1);

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
        effect: { ...rules.defaultEffect, ...inferred.effect },
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

  // cue numbers are positional, so they are assigned once the order is final
  let cueNumber = 1;
  for (const entry of rundown) {
    if (isOntimeEvent(entry)) {
      entry.cue = String(cueNumber++);
    }
  }

  /* --- what the mirror cannot represent ------------------------------------ */

  // only the master section gets mirrored, so PRE divergence is harmless
  const mirroredItemIds = new Set(
    serviceSection.map(({ entry }) => entryToItem.get(entry.id)).filter((itemId): itemId is string => Boolean(itemId)),
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

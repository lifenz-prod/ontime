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

import { compileMatcher, matchesRule } from './pcoRules.js';
import { localDateKey, localDayLabel, localTimeOfDayMs } from './pcoTime.js';
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

/** default effect, then the first matching rule on top */
function resolveEffect(item: PcoItem, rules: PcoRules): { effect: PcoRuleEffect; ruleName: string | null } {
  const candidate = itemCandidate(item);
  for (const rule of rules.timerRules) {
    if (matchesRule(rule.match, candidate)) {
      return { effect: { ...baseEffect(rules), ...rule.effect }, ruleName: rule.name };
    }
  }
  return { effect: baseEffect(rules), ruleName: null };
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
  const stripper = compileMatcher(rules.titleStrip);
  const titleOf = (item: PcoItem): string => {
    const raw = item.attributes.title ?? '';
    return stripper ? raw.replace(stripper, '').trim() : raw;
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

    for (let index = 0; index < sectionItems.length; index++) {
      const item = sectionItems[index];
      const collapse = rules.collapseSections.find((rule) => matchesRule(rule.match, itemCandidate(item)));

      if (collapse) {
        // the section runs to the item before the next heading, which is how the
        // run sheet delimits one in the first place
        const members: PcoItem[] = [];
        while (index + 1 < sectionItems.length && sectionItems[index + 1].attributes.item_type !== 'header') {
          index += 1;
          members.push(sectionItems[index]);
        }
        units.push({
          title: collapse.title?.trim() || titleOf(item),
          // the set list is the entire content of the section, and folding it away
          // silently is the one thing the person calling the show cannot undo
          note: collapse.listContents === false ? '' : members.map(titleOf).filter(Boolean).join('\n'),
          duration: members.reduce((total, member) => total + durationOf(member), durationOf(item)),
          effect: { ...resolveEffect(item, rules).effect, ...collapse.effect },
          isBlock: false,
          itemIds: [item.id, ...members.map((member) => member.id)],
        });
        continue;
      }

      if (matchesAny(rules.mergeIntoPrevious, item)) {
        const previous = units.at(-1);
        if (previous && !previous.isBlock) {
          previous.duration += durationOf(item);
          previous.itemIds.push(item.id);
          mergedItemIds.add(item.id);
          continue;
        }
        // nothing above it to give the time to, so it keeps a row of its own
        strandedMerges.push(titleOf(item) || 'untitled');
      } else if (matchesAny(rules.ignoreItems, item)) {
        continue;
      }

      const isHeader = item.attributes.item_type === 'header';
      if (isHeader && rules.headersBecome === 'nothing') {
        continue;
      }

      units.push({
        title: titleOf(item),
        note: item.attributes.description ?? '',
        duration: durationOf(item),
        effect: resolveEffect(item, rules).effect,
        isBlock: isHeader && rules.headersBecome === 'block',
        itemIds: [item.id],
      });
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

  const unitsInPosition = (position: PcoItem['attributes']['service_position']): BuildUnit[] =>
    toUnits(kept.filter((item) => item.attributes.service_position === position));

  const preUnits = unitsInPosition('pre');
  const duringUnits = unitsInPosition('during');
  const postUnits = unitsInPosition('post');

  if (preUnits.length + duringUnits.length + postUnits.length === 0) {
    warnings.push('No items survived the filters; the rundown will only contain inferred entries.');
  }

  // where the pre-service run begins
  const preTotal = preUnits.reduce((total, unit) => total + unit.duration, 0);
  const preAnchorTime = day.otherTimes[0];
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

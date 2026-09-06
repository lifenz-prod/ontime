/**
 * Naming and selection rules for Planning Center rundown sources.
 *
 * Kept apart from PcoService.ts, which reads the environment and the rules file,
 * so that deciding *which* service type and *which* plan stays pure and testable.
 */

import type {
  PcoItemDisposition,
  PcoItemType,
  PcoKnownItem,
  PcoPinnedServiceType,
  PcoPlanSheetItem,
  PcoPlanSummary,
  PcoRuleEffect,
  PcoRules,
  PcoServicePosition,
  PcoTimerRule,
} from 'ontime-types';

import { PcoError, planDateKey } from './PcoClient.js';
import { localTimeOfDayMs } from './pcoTime.js';
import { followOnFor, matchesRule, respellWords, splitIncludedParts, stripTitle } from './pcoRules.js';
import {
  buildExclusionLookup,
  parseTitleTime,
  planSectionFolds,
  toLeadingCapitals,
  rehearsalSteps,
  resolveEffectFor,
  scopeRulesToServiceType,
  titleWithoutTime,
  wrapTimeOfDay,
  type PcoPlanDay,
  type SectionFold,
} from './pcoRundownBuilder.js';
import type { PcoItem, PcoItemTime, PcoPlan, PcoServicePosition as PcoItemPosition, PcoServiceType } from './pcoTypes.js';

/** the parts of the configuration that identify a service type */
export type ServiceTypeSelector = {
  /** id pinned through the environment, which wins over the rules file */
  pinnedServiceTypeId?: string | null;
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
  /** ids kept on the import tab; the first is used when nothing else is configured */
  pinnedServiceTypes?: { id: string }[];
};

/**
 * Picks the service type to pull plans from.
 *
 * An id wins over a name, a name is matched case insensitively on a substring so
 * "central am" finds "Central AM Service", and an organisation with a single
 * service type needs no configuration at all. Anything else is ambiguous, and the
 * error lists the ids so the choice can be pinned.
 */
export function resolveServiceType(serviceTypes: PcoServiceType[], selector: ServiceTypeSelector): PcoServiceType {
  if (serviceTypes.length === 0) {
    throw new PcoError('Planning Center returned no service types for this organisation');
  }

  const wantedId = selector.pinnedServiceTypeId || selector.serviceTypeId;
  if (wantedId) {
    const found = serviceTypes.find((candidate) => candidate.id === String(wantedId));
    if (!found) {
      throw new PcoError(`No Planning Center service type with id ${wantedId}. ${describeServiceTypes(serviceTypes)}`);
    }
    return found;
  }

  const wantedName = selector.serviceTypeName?.trim().toLowerCase();
  if (wantedName) {
    const matches = serviceTypes.filter((candidate) => candidate.attributes.name.toLowerCase().includes(wantedName));
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length === 0) {
      throw new PcoError(
        `No Planning Center service type matching "${selector.serviceTypeName}". ${describeServiceTypes(serviceTypes)}`,
      );
    }
    throw new PcoError(
      `"${selector.serviceTypeName}" matches ${matches.length} Planning Center service types. ${describeServiceTypes(matches)}`,
    );
  }

  // a pinned service type is a choice already made in the settings panel
  const firstPinned = selector.pinnedServiceTypes?.[0]?.id;
  if (firstPinned) {
    const found = serviceTypes.find((candidate) => candidate.id === String(firstPinned));
    if (found) {
      return found;
    }
  }

  if (serviceTypes.length === 1) {
    return serviceTypes[0];
  }

  throw new PcoError(
    `Planning Center has ${serviceTypes.length} service types, pin one on the Planning Center tab or set serviceTypeId in pco-rules.json. ${describeServiceTypes(serviceTypes)}`,
  );
}

/** how many ids an error message lists; this organisation has over three hundred */
const MAX_LISTED_SERVICE_TYPES = 15;

export function describeServiceTypes(serviceTypes: PcoServiceType[]): string {
  const listed = serviceTypes
    .slice(0, MAX_LISTED_SERVICE_TYPES)
    .map((candidate) => `${candidate.id} "${candidate.attributes.name.trim()}"`)
    .join(', ');
  const remaining = serviceTypes.length - MAX_LISTED_SERVICE_TYPES;

  return remaining > 0 ? `Available: ${listed}, and ${remaining} more` : `Available: ${listed}`;
}

/**
 * The name a plan is recalled by: the date it runs on.
 *
 * The date, because that is what a run sheet is known by and what someone can type
 * into a Companion button. PCO plan titles are usually empty and series titles
 * repeat across weeks, so neither identifies a plan on its own.
 *
 * No timezone conversion: `planDateKey` reads a date PCO already writes in local
 * terms. See its comment, which carries the live evidence.
 */
export function planSourceName(plan: PcoPlan): string {
  return planDateKey(plan) ?? `plan-${plan.id}`;
}

/**
 * Names for a list of plans, in the order they were given.
 * A service type can hold two plans on one date; the later ones carry their plan id
 * so that every name still addresses exactly one plan.
 */
export function planSourceNames(plans: PcoPlan[]): string[] {
  const taken = new Set<string>();

  return plans.map((plan) => {
    const name = planSourceName(plan);
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const unique = `${name} (${plan.id})`;
    taken.add(unique);
    return unique;
  });
}

/** Finds the plan a source name addresses, matched as `planSourceNames` writes them */
export function findPlanBySourceName(plans: PcoPlan[], name: string): PcoPlan | undefined {
  const target = name.trim().toLowerCase();
  const names = planSourceNames(plans);
  const index = names.findIndex((candidate) => candidate.toLowerCase() === target);
  return index === -1 ? undefined : plans[index];
}

/* -------------------------------------------------------------------------- */
/* what the settings UI reads                                                  */
/* -------------------------------------------------------------------------- */

/** milliseconds since midnight rendered as HH:MM, for a plan's own local stamp */
function clockFromSortDate(sortDate: string | null): string | null {
  // sort_date is local wall clock with a spurious Z, so the time part is read as written
  const time = sortDate?.split('T')[1];
  return time ? time.slice(0, 5) : null;
}

/** One plan as the import tab shows it */
export function planSummary(plan: PcoPlan, serviceType: { id: string; name: string }): PcoPlanSummary {
  return {
    serviceTypeId: serviceType.id,
    serviceTypeName: serviceType.name.trim(),
    planId: plan.id,
    date: planSourceName(plan),
    dates: plan.attributes.dates,
    title: plan.attributes.title,
    seriesTitle: plan.attributes.series_title,
    itemsCount: plan.attributes.items_count,
    firstServiceTime: clockFromSortDate(plan.attributes.sort_date),
  };
}

/**
 * What the import would do with an item.
 *
 * The order mirrors the builder: a section fold claims an item first, then a merge
 * into the entry above, then the ignore list. Only what survives all three is an
 * entry, and only an entry can carry the settings the panel offers.
 */
export function dispositionOf(
  rules: PcoRules,
  candidate: { title: string; itemType: PcoItemType; servicePosition: PcoServicePosition },
): PcoItemDisposition {
  /**
   * A choice made on a row beats every rule that would otherwise claim the item.
   * Nothing on a run sheet is out of reach of its own row: asking for a timed event
   * takes an item out of a fold or out of a merge, which is the only way somebody
   * looking at the sheet can give it a cue.
   */
  const { importAs } = resolveEffectFor(candidate, rules).effect;
  if (importAs) {
    return dispositionFromImportAs(importAs);
  }

  if (rules.collapseSections.some((rule) => matchesRule(rule.match, candidate))) {
    return 'collapsed';
  }
  if (rules.mergeIntoPrevious.some((match) => matchesRule(match, candidate))) {
    return 'merged';
  }
  if (rules.ignoreItems.some((match) => matchesRule(match, candidate))) {
    return 'ignored';
  }

  if (candidate.itemType === 'header') {
    return rules.headersBecome === 'block' ? 'block' : rules.headersBecome === 'nothing' ? 'ignored' : 'event';
  }
  return 'event';
}

/** the rule that would claim an item, so the panel can show what is already covered */
export function ruleMatching(rules: PcoTimerRule[], candidate: PcoKnownItem): string | null {
  const found = rules.find((rule) =>
    matchesRule(rule.match, {
      title: candidate.title,
      itemType: candidate.itemType,
      servicePosition: candidate.servicePosition,
    }),
  );
  return found?.name ?? null;
}

/**
 * Collapses the items of several plans into the distinct titles a run sheet uses,
 * so the settings panel can offer what is actually on the sheets rather than asking
 * for a regex.
 *
 * Titles are grouped case insensitively and after `titleStrip`, because
 * "Doors Open // 9am" and "Doors Open // 11am" are one thing to configure, not two.
 * The most common spelling wins the label.
 */
export function knownItemsFromPlans(plans: PcoItem[][], rules: PcoRules): PcoKnownItem[] {
  const normalise = (title: string): string => stripTitle(title, rules.titleStrip);

  type Tally = {
    labels: Map<string, number>;
    itemType: PcoKnownItem['itemType'];
    servicePosition: PcoKnownItem['servicePosition'];
    plans: Set<number>;
    lengths: number[];
  };
  const tallies = new Map<string, Tally>();

  plans.forEach((items, planIndex) => {
    for (const item of items) {
      const label = normalise(item.attributes.title ?? '');
      if (!label) {
        continue;
      }
      const key = label.toLowerCase();
      const tally = tallies.get(key) ?? {
        labels: new Map(),
        itemType: item.attributes.item_type,
        servicePosition: item.attributes.service_position,
        plans: new Set<number>(),
        lengths: [],
      };
      tally.labels.set(label, (tally.labels.get(label) ?? 0) + 1);
      tally.plans.add(planIndex);
      if (item.attributes.length) {
        tally.lengths.push(item.attributes.length);
      }
      tallies.set(key, tally);
    }
  });

  const known: PcoKnownItem[] = [...tallies.values()].map((tally) => {
    const [label] = [...tally.labels.entries()].sort((a, b) => b[1] - a[1])[0];
    const title = label;
    const item: PcoKnownItem = {
      title,
      itemType: tally.itemType,
      servicePosition: tally.servicePosition,
      planCount: tally.plans.size,
      typicalLength: tally.lengths.length > 0 ? median(tally.lengths) : null,
      matchedBy: null,
      disposition: 'event',
    };
    const candidate = { title, itemType: item.itemType, servicePosition: item.servicePosition };

    return {
      ...item,
      matchedBy: ruleMatching(rules.timerRules, item),
      disposition: dispositionOf(rules, candidate),
    };
  });

  // the things on every sheet first, then alphabetically, so the list is stable
  return known.sort((a, b) => b.planCount - a.planCount || a.title.localeCompare(b.title));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

/**
 * An application id with its middle removed, so the panel can show which token is
 * in use without showing enough to use it. Short ids are hidden entirely rather
 * than partly revealed.
 */
export function maskCredentialId(applicationId: string): string {
  const id = applicationId.trim();
  if (id.length <= 12) {
    return '•'.repeat(Math.max(id.length, 4));
  }
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* pinned service types as recallable sources                                  */
/* -------------------------------------------------------------------------- */

/**
 * The names the pinned service types are recalled by.
 *
 * A service type name, not a plan date. This is the point of addressing Planning
 * Center by favourite: "Central AM" means the next Central AM service, so a
 * Companion button keeps working next week, where a button holding 2026-08-23 is
 * dead by Monday.
 *
 * Two campuses can pin service types with the same name, so a duplicate is
 * qualified by its group.
 */
export function pinnedSourceNames(pinned: PcoPinnedServiceType[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of pinned) {
    const key = entry.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const taken = new Set<string>();

  return pinned.map((entry) => {
    const name = entry.name.trim();
    const duplicated = (counts.get(name.toLowerCase()) ?? 0) > 1;
    const qualified = duplicated && entry.group?.trim() ? `${entry.group.trim()} ${name}` : name;

    if (!taken.has(qualified.toLowerCase())) {
      taken.add(qualified.toLowerCase());
      return qualified;
    }
    // still not unique: fall back to the id, which always is
    const unique = `${qualified} (${entry.id})`;
    taken.add(unique.toLowerCase());
    return unique;
  });
}

/** Finds the pinned service type a source name addresses */
export function findPinnedBySourceName(pinned: PcoPinnedServiceType[], name: string): PcoPinnedServiceType | undefined {
  const target = name.trim().toLowerCase();
  const names = pinnedSourceNames(pinned);
  const index = names.findIndex((candidate) => candidate.toLowerCase() === target);
  return index === -1 ? undefined : pinned[index];
}

/**
 * The morning of one plan, resolved through the rules exactly as the import will.
 *
 * Where `knownItemsFromPlans` tallies titles across the next few plans so the
 * settings panel can offer what a service type usually holds, this is the plan in
 * front of the person about to import it.
 *
 * All of it, not only the run sheet. The production run above the sheet is read
 * from the plan's `rehearsal` times and the lead-in ahead of that is stated in the
 * rules, and both become entries -- so both are rows here. A page that listed only
 * the items would be a partial account of what the import does.
 *
 * Only the build day's rehearsal times. A plan routinely carries a midweek
 * rehearsal alongside the Sunday one, and an Ontime rundown is a single day: the
 * Wednesday times belong to a morning this import is not building.
 */
/** an `importAs` choice as a disposition, which is the vocabulary the page reads */
function dispositionFromImportAs(importAs: PcoRuleEffect['importAs']): PcoItemDisposition {
  if (importAs === 'omit') return 'ignored';
  if (importAs === 'block') return 'block';
  return 'event';
}

export function planSheetItems(
  items: PcoItem[],
  rules: PcoRules,
  serviceTypeId: string,
  /** the day the rundown will be built for; without it only the run sheet is listed */
  day?: PcoPlanDay,
  /**
   * The plan's ItemTimes, which is how Planning Center says an item belongs to one
   * service and not the other. Without them the page lists both halves of a
   * per-service pair as if the import kept both, and the clock it lays them on is
   * wrong by the length of the one the import drops.
   */
  itemTimes: PcoItemTime[] = [],
): PcoPlanSheetItem[] {
  const scoped = scopeRulesToServiceType(rules, serviceTypeId);
  const ownRuleNames = new Set((rules.serviceTypeRules?.[serviceTypeId] ?? []).map((rule) => rule.name));
  const masterTime = day?.serviceTimes[0];
  const serviceStartOfDay = masterTime ? localTimeOfDayMs(masterTime.attributes.starts_at, scoped.timezone) : undefined;

  const exclusions = buildExclusionLookup(itemTimes);
  /** kept out of the master service by Planning Center, so the mirror generates it instead */
  const excludedFromMaster = (item: PcoItem): boolean =>
    scoped.respectMasterExclusions && masterTime !== undefined && exclusions.isExcludedFrom(item.id, masterTime.id);

  /** the shared half of a row: how the rules resolve a title */
  const resolve = (title: string, itemType: PcoItemType, servicePosition: PcoServicePosition) => {
    const candidate = { title, itemType, servicePosition };
    const { effect, ruleName } = resolveEffectFor(candidate, scoped);
    return {
      disposition: dispositionOf(scoped, candidate),
      matchedBy: ruleName,
      matchedByServiceType: ruleName !== null && ownRuleNames.has(ruleName),
      effect,
    };
  };

  const rows: PcoPlanSheetItem[] = [];

  /* --- the production run, read off the plan's rehearsal times -------------- */

  const steps = day && scoped.deriveRehearsalTimes ? rehearsalSteps(day.rehearsalTimes, scoped.timezone) : [];

  if (scoped.leadIn && steps.length > 0) {
    const title = scoped.leadIn.title;
    rows.push({
      id: 'lead-in',
      source: 'lead-in',
      title,
      sourceTitle: title,
      itemType: 'item',
      servicePosition: 'pre',
      duration: scoped.leadIn.duration,
      startsAt: steps[0].start - scoped.leadIn.duration,
      alongside: null,
      ...resolve(title, 'item', 'pre'),
    });
  }

  /**
   * The production run, whose rows are placed by the plan rather than by the run
   * sheet's own clock. A step the plan gave no end to runs until whatever happens
   * next -- and the last of them until the run sheet's first item, which is not known
   * until every length below is in. So they are collected here and timed at the end.
   */
  const derived: { row: PcoPlanSheetItem; start: number; end: number | null }[] = [];

  for (const step of steps) {
    const row: PcoPlanSheetItem = {
      id: step.id,
      source: 'rehearsal',
      title: step.title,
      sourceTitle: step.title,
      itemType: 'item',
      servicePosition: 'pre',
      duration: 0,
      startsAt: step.start,
      alongside: step.note || null,
      ...resolve(step.title, 'item', 'pre'),
    };
    rows.push(row);
    derived.push({ row, start: step.start, end: step.end });
  }

  /* --- the run sheet -------------------------------------------------------- */

  const ordered = [...items].sort((a, b) => (a.attributes.sequence ?? 0) - (b.attributes.sequence ?? 0));

  /**
   * The folds, planned exactly as the build plans them and per position group, since
   * that is how the builder lays a section out. Without this the page could only say
   * that a heading was folded, never which of the items under it went with it -- and
   * with `membersMatch` that is the whole question.
   */
  const folds = { opens: new Map<string, SectionFold>(), swallowed: new Set<string>() };
  for (const position of ['pre', 'during', 'post'] as const) {
    const planned = planSectionFolds(
      ordered.filter((item) => item.attributes.service_position === position),
      scoped,
    );
    planned.opens.forEach((fold, id) => folds.opens.set(id, fold));
    planned.swallowed.forEach((id) => folds.swallowed.add(id));
  }

  /** the fold a swallowed item ended up in, so the row can say where its time went */
  const foldTitleFor = (id: string): string | undefined => {
    for (const fold of folds.opens.values()) {
      if (fold.members.some((member) => member.id === id)) {
        return fold.title;
      }
    }
    return undefined;
  };

  /** how far each row moves the run sheet's clock, which is not always its own length */
  const placed: { row: PcoPlanSheetItem; position: PcoItemPosition; advance: number }[] = [];
  /** the last row of each group that takes a cue, which is what a merge hands its time to */
  const absorbing = new Map<PcoItemPosition, PcoPlanSheetItem>();
  const lengthOf = (candidate: PcoItem): number => Math.max(0, (candidate.attributes.length ?? 0) * 1000);
  const masterName = masterTime ? (scoped.serviceNames[0] ?? masterTime.attributes.name ?? 'the first service') : '';

  for (const item of ordered) {
    const sourceTitle = item.attributes.title ?? '';
    const itemType = item.attributes.item_type;
    const servicePosition = item.attributes.service_position;
    const cleaned = stripTitle(sourceTitle, scoped.titleStrip);
    const stripped = respellWords(scoped.normaliseTitleCase ? toLeadingCapitals(cleaned) : cleaned, scoped.titleWords);

    /**
     * A lengthless heading stating a time before the service is not dropped: it
     * becomes an entry at the time it names, titled without the time. The row is
     * named the same way, so a rule written here reaches that entry.
     */
    const stated =
      scoped.deriveTimedHeaders && itemType === 'header' && !item.attributes.length
        ? parseTitleTime(sourceTitle)
        : null;
    const startsAt = stated !== null && (serviceStartOfDay === undefined || stated < serviceStartOfDay) ? stated : null;
    // cased again once the time is off it, for the same reason the builder does
    const withoutTime = titleWithoutTime(stripped);
    const title =
      startsAt === null
        ? stripped
        : respellWords(scoped.normaliseTitleCase ? toLeadingCapitals(withoutTime) : withoutTime, scoped.titleWords);

    /** the title the rules see, which is the entry's own once a timed heading is read */
    const ruleTitle = startsAt !== null ? title : sourceTitle;
    const resolved = resolve(ruleTitle, itemType, servicePosition);
    const excluded = excludedFromMaster(item);

    /**
     * What the build will do with this row, in the order the build decides it: an
     * item Planning Center keeps out of the master never gets there at all, then a
     * fold claims one, then a timed heading is imported whatever its kind would
     * otherwise make it, then the ordinary rules.
     */
    const dispositionOfRow = (): PcoItemDisposition => {
      if (excluded) return 'ignored';
      // the heading that opens a fold IS the event: it carries the section's time and
      // takes every setting an event takes, so the row says so rather than "folded"
      if (folds.opens.has(item.id)) return 'event';
      if (folds.swallowed.has(item.id)) return 'collapsed';
      if (startsAt !== null) return dispositionFromImportAs(resolved.effect.importAs);
      return resolved.disposition;
    };

    const disposition = dispositionOfRow();
    const split = splitIncludedParts(title, scoped.splitIncluded);
    const fold = folds.opens.get(item.id);

    /**
     * A follow-on holds the item to a length the sheet does not give it, so the row
     * has to show the held length rather than the plan's -- otherwise the page says
     * the prayer meeting is twenty-five minutes and the import makes it ten. A fold
     * never takes one: the build claims it before it ever gets that far.
     */
    const follow =
      disposition === 'event' && !fold
        ? followOnFor({ title: ruleTitle, itemType, servicePosition }, scoped)
        : null;
    const full = lengthOf(item);

    /**
     * What the entry will be, and what the row moves the clock by. The two differ
     * wherever a row accounts for time that is not its own: a fold shows its whole
     * section and moves the clock only by its own length, because its members move it
     * by theirs. A row that never reaches the rundown moves it by nothing.
     */
    const shown = fold ? fold.members.reduce((total, member) => total + lengthOf(member), 0) : (follow?.hold ?? full);
    const advance = disposition === 'ignored' || startsAt !== null ? 0 : fold ? full : shown;

    const row: PcoPlanSheetItem = {
      id: item.id,
      source: 'item',
      /**
       * What the entry will be called, in the order the build decides it: a fold
       * names its own event, then a rename, then the item's own title. A row naming
       * the item where the rundown will name the fold would be the page disagreeing
       * with the import over the one thing a person reads first.
       */
      title: fold?.title || resolved.effect.title?.trim() || split.title,
      sourceTitle,
      itemType,
      servicePosition,
      duration: shown,
      startsAt,
      alongside: folds.swallowed.has(item.id) ? (foldTitleFor(item.id) ?? null) : null,
      includedIn: null,
      follows: null,
      excludedFrom: excluded ? masterName : null,
      ...resolved,
      disposition,
    };

    rows.push(row);
    placed.push({ row, position: servicePosition, advance });

    // a heading read as a time of its own is part of the production run, not the run
    // sheet: it is timed by what follows it, exactly as a rehearsal time is
    if (startsAt !== null) {
      derived.push({ row, start: startsAt, end: null });
    }

    /**
     * A merged item gives its length to the entry above it, so that entry is longer
     * than the plan states -- doors plus the online message it carries. The page has
     * to say so, or its own times will not add up on the screen.
     */
    if (disposition === 'merged') {
      const previous = absorbing.get(servicePosition);
      if (previous) {
        previous.duration += full;
      }
    } else if (disposition === 'event' || disposition === 'block') {
      absorbing.set(servicePosition, row);
    }

    /**
     * The parts an item says it includes are entries of their own, so they are rows
     * of their own -- at nothing, which is the point of them. Without this the page
     * would list one row where the import makes three, which is the one thing it
     * must never do.
     */
    if (disposition === 'event') {
      for (const part of split.parts) {
        const partRow: PcoPlanSheetItem = {
          id: `${item.id}:${part}`,
          source: 'item',
          title: part,
          sourceTitle: part,
          itemType,
          servicePosition,
          duration: 0,
          startsAt: null,
          alongside: null,
          includedIn: split.title,
          follows: null,
          excludedFrom: null,
          ...resolve(part, 'item', servicePosition),
        };
        rows.push(partRow);
        placed.push({ row: partRow, position: servicePosition, advance: 0 });
      }
    }

    /**
     * The entry a follow-on rule adds is a row of its own, taking the time the item
     * was held back from. Listing one row where the import makes two is the one thing
     * this page must never do.
     */
    if (follow) {
      const resolvedFollow = resolve(follow.title, 'item', servicePosition);
      const effect = { ...resolvedFollow.effect, ...follow.effect };
      const remainder = Math.max(0, full - (follow.hold ?? full));
      const followRow: PcoPlanSheetItem = {
        id: `${item.id}:follows`,
        source: 'item',
        title: follow.title,
        sourceTitle: follow.title,
        itemType: 'item',
        servicePosition,
        duration: remainder,
        startsAt: null,
        alongside: null,
        includedIn: null,
        follows: split.title,
        excludedFrom: null,
        ...resolvedFollow,
        effect,
        disposition: effect.importAs ? dispositionFromImportAs(effect.importAs) : resolvedFollow.disposition,
      };
      rows.push(followRow);
      placed.push({ row: followRow, position: servicePosition, advance: remainder });
    }
  }

  /* --- the run sheet on the clock -------------------------------------------
   * Exactly how the build places a section: `pre` is one contiguous run ending at
   * the service start, `during` accumulates forward from it, and `post` carries on
   * where `during` finishes. Laying them out any other way would put times on the
   * page that the import is not going to produce.
   *
   * Without a day there is no service time to place anything against, so the run
   * sheet rows keep the blank they have always had.
   */

  if (serviceStartOfDay !== undefined) {
    const totalOf = (position: PcoItemPosition): number =>
      placed.reduce((total, entry) => (entry.position === position ? total + entry.advance : total), 0);

    // a rehearsal time that has become an entry of its own cannot also be what the
    // run sheet hangs off, which is the rule the build anchors by
    const preAnchorTime = day?.otherTimes.find(
      (time) => !(scoped.deriveRehearsalTimes && time.attributes.time_type === 'rehearsal'),
    );
    /** where the run sheet opens, which is also what the production run hands over to */
    const preStart =
      scoped.preAnchor === 'plan-time' && preAnchorTime
        ? localTimeOfDayMs(preAnchorTime.attributes.starts_at, scoped.timezone)
        : serviceStartOfDay - totalOf('pre');

    const cursors: Record<PcoItemPosition, number> = {
      pre: preStart,
      during: serviceStartOfDay,
      post: serviceStartOfDay + totalOf('during'),
    };

    for (const entry of placed) {
      // a heading that states its own time keeps it; nothing else knows where it sits
      // until every length above it is in
      if (entry.row.startsAt === null) {
        entry.row.startsAt = wrapTimeOfDay(cursors[entry.position]);
      }
      cursors[entry.position] += entry.advance;
    }

    /**
     * Each step of the production run lasts until the next one starts, and the last
     * of them hands over to the run sheet. So the briefing is five minutes because
     * the broadcast brief follows it, and the broadcast brief is ten because the
     * prayer meeting back-times to 8:20.
     */
    const runHandsOverAt = preStart;
    const inClockOrder = [...derived].sort((a, b) => a.start - b.start);

    for (let index = 0; index < inClockOrder.length; index++) {
      const step = inClockOrder[index];
      const end = step.end ?? inClockOrder[index + 1]?.start ?? runHandsOverAt;
      step.row.duration = Math.max(0, end - step.start);
    }
  }

  return rows;
}

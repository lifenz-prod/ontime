/**
 * Naming and selection rules for Planning Center rundown sources.
 *
 * Kept apart from PcoService.ts, which reads the environment and the rules file,
 * so that deciding *which* service type and *which* plan stays pure and testable.
 */

import type { PcoKnownItem, PcoPlanSummary, PcoRules, PcoTimerRule } from 'ontime-types';

import { PcoError, planDateKey } from './PcoClient.js';
import { matchesRule } from './pcoRules.js';
import type { PcoItem, PcoPlan, PcoServiceType } from './pcoTypes.js';

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
  const stripMatcher = rules.titleStrip ? new RegExp(rules.titleStrip, 'i') : null;
  const normalise = (title: string): string => {
    const stripped = stripMatcher ? title.replace(stripMatcher, '') : title;
    return stripped.trim();
  };

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
      ignored: false,
    };
    const candidate = { title, itemType: item.itemType, servicePosition: item.servicePosition };

    return {
      ...item,
      matchedBy: ruleMatching(rules.timerRules, item),
      ignored: rules.ignoreItems.some((match) => matchesRule(match, candidate)),
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

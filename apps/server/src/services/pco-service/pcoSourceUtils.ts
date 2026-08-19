/**
 * Naming and selection rules for Planning Center rundown sources.
 *
 * Kept apart from PcoService.ts, which reads the environment and the rules file,
 * so that deciding *which* service type and *which* plan stays pure and testable.
 */

import { PcoError, planDateKey } from './PcoClient.js';
import type { PcoPlan, PcoServiceType } from './pcoTypes.js';

/** the parts of the configuration that identify a service type */
export type ServiceTypeSelector = {
  /** id pinned through the environment, which wins over the rules file */
  pinnedServiceTypeId?: string | null;
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
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

  if (serviceTypes.length === 1) {
    return serviceTypes[0];
  }

  throw new PcoError(
    `Planning Center has ${serviceTypes.length} service types, set serviceTypeId or serviceTypeName in pco-rules.json. ${describeServiceTypes(serviceTypes)}`,
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

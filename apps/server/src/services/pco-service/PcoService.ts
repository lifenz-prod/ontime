/**
 * The app-facing half of the Planning Center connector.
 *
 * `PcoClient` knows how to talk to the API and `pcoRundownBuilder` knows how to
 * turn a plan into a rundown. This module is what the rest of the server sees: it
 * answers whether the connector is usable, lists the plans which can be recalled,
 * and builds one of them on demand.
 *
 * It is registered as a rundown source provider, so a plan is recalled through the
 * same `loadsource` command as a Google Sheet tab and lands in the project through
 * the same guarded path. See services/rundown-source-service.
 *
 * Credentials are read from the environment only, never written to disk:
 *   PCO_APP_ID / PCO_SECRET   a Personal Access Token pair
 *   PCO_SERVICE_TYPE_ID       optional, pins the service type
 *   PCO_TIMEZONE              optional, overrides the timezone in pco-rules.json
 */

import { LogOrigin, type MaybeString } from 'ontime-types';

import { logger } from '../../classes/Logger.js';

import { PcoClient, PcoError, type PcoCredentials } from './PcoClient.js';
import type { PcoRules } from './pcoRules.js';
import { ensurePcoRulesFile, readPcoRules } from './pcoRulesFile.js';
import { buildRundownFromPlan, type PcoBuildResult } from './pcoRundownBuilder.js';
import { findPlanBySourceName, planSourceNames, resolveServiceType } from './pcoSourceUtils.js';

/** how many upcoming plans are offered as sources; a service type publishes months ahead */
const PLAN_LIST_LIMIT = 12;

const missingCredentialsMessage =
  'Planning Center credentials are not set. Add PCO_APP_ID and PCO_SECRET from a Personal Access Token ' +
  'created at https://api.planningcenteronline.com/oauth/applications';

/**
 * The resolved service type, remembered so that listing plans does not re-read the
 * service type list on every refresh. Keyed by the configuration it was resolved
 * from, so editing pco-rules.json takes effect without a restart.
 */
let resolvedServiceType: { key: string; id: string; name: string } | null = null;

export type PcoConfig = {
  rules: PcoRules;
  credentials: PcoCredentials | null;
  /** id pinned through the environment, which wins over the rules file */
  pinnedServiceTypeId: MaybeString;
};

/**
 * Reads the environment and the rules file.
 * The timezone override is applied here so every caller sees the same rules.
 *
 * The rules file is written out as soon as credentials appear, so that whoever is
 * setting Planning Center up has a document to turn `enabled` on in. Without
 * credentials nothing is created: this runs on every source refresh, and a project
 * which has nothing to do with PCO should not collect its config file.
 */
export function getPcoConfig(): PcoConfig {
  const timezone = process.env.PCO_TIMEZONE;
  const applicationId = process.env.PCO_APP_ID;
  const secret = process.env.PCO_SECRET;

  if (applicationId && secret) {
    ensurePcoRulesFile();
  }
  const rules = readPcoRules();

  return {
    rules: timezone ? { ...rules, timezone } : rules,
    credentials: applicationId && secret ? { applicationId, secret } : null,
    pinnedServiceTypeId: process.env.PCO_SERVICE_TYPE_ID || null,
  };
}

export function hasPcoCredentials(): boolean {
  return getPcoConfig().credentials !== null;
}

/**
 * Whether the connector should serve the project's rundown sources.
 *
 * Both halves are deliberate: `enabled` in pco-rules.json is the decision to use
 * Planning Center instead of the linked sheet, the credentials are the ability to.
 */
export function isPcoEnabled(): boolean {
  const { rules, credentials } = getPcoConfig();
  return rules.enabled && credentials !== null;
}

/** The service type currently in use, once something has resolved it */
export function getResolvedServiceTypeId(): MaybeString {
  return resolvedServiceType?.id ?? null;
}

/** identifies the configuration a cached resolution came from */
function configKey(config: PcoConfig): string {
  return [config.pinnedServiceTypeId, config.rules.serviceTypeId, config.rules.serviceTypeName].join('|');
}

function getClient(config: PcoConfig): PcoClient {
  if (!config.credentials) {
    throw new PcoError(missingCredentialsMessage, 401);
  }
  return new PcoClient(config.credentials);
}

/**
 * Resolves the service type, reusing the cached answer while the configuration
 * behind it is unchanged.
 */
async function useServiceType(client: PcoClient, config: PcoConfig): Promise<{ id: string; name: string }> {
  const key = configKey(config);
  if (resolvedServiceType?.key === key) {
    return resolvedServiceType;
  }

  const serviceType = resolveServiceType(await client.getServiceTypes(), {
    pinnedServiceTypeId: config.pinnedServiceTypeId,
    serviceTypeId: config.rules.serviceTypeId,
    serviceTypeName: config.rules.serviceTypeName,
  });
  resolvedServiceType = { key, id: serviceType.id, name: serviceType.attributes.name };
  logger.info(LogOrigin.Server, `Planning Center service type ${serviceType.id} "${serviceType.attributes.name}"`);

  return resolvedServiceType;
}

/**
 * The plans which can be recalled, soonest first, so index 1 is the next service.
 */
export async function listPcoSources(): Promise<string[]> {
  const config = getPcoConfig();
  const client = getClient(config);
  const serviceType = await useServiceType(client, config);

  const plans = await client.getFuturePlans(serviceType.id, PLAN_LIST_LIMIT);
  return planSourceNames(plans);
}

/**
 * Builds the rundown for one plan.
 *
 * Custom fields are not returned: a plan carries no column mapping, so the ones
 * already in the project are kept. Divergence between the two service times is
 * reported to the log rather than silently flattened.
 */
export async function fetchPcoSource(name: string): Promise<Pick<PcoBuildResult, 'rundown' | 'serviceProfiles'>> {
  const config = getPcoConfig();
  const client = getClient(config);
  const serviceType = await useServiceType(client, config);

  const plans = await client.getFuturePlans(serviceType.id, PLAN_LIST_LIMIT);
  const plan = findPlanBySourceName(plans, name);

  if (!plan) {
    throw new PcoError(
      `No Planning Center plan named "${name}" in "${serviceType.name}". ` +
        `Available: ${planSourceNames(plans).join(', ') || 'none'}`,
    );
  }

  const [planTimes, content] = await Promise.all([
    client.getPlanTimes(serviceType.id, plan.id),
    client.getPlanContent(serviceType.id, plan.id),
  ]);

  const result = buildRundownFromPlan({
    plan,
    planTimes,
    items: content.items,
    itemTimes: content.itemTimes,
    rules: config.rules,
  });

  logger.info(
    LogOrigin.Server,
    `Built ${result.rundown.length} entries from Planning Center plan ${plan.id} (${result.day.label})`,
  );
  for (const warning of result.warnings) {
    logger.warning(LogOrigin.Server, `Planning Center: ${warning}`);
  }

  return { rundown: result.rundown, serviceProfiles: result.serviceProfiles };
}

/** Drops the cached service type, so the next call resolves it again */
export function resetPcoCache(): void {
  resolvedServiceType = null;
}

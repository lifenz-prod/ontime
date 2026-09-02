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
 * Credentials are read from the environment, never written to disk:
 *   PCO_APP_ID / PCO_SECRET   a Personal Access Token pair
 *   PCO_SERVICE_TYPE_ID       optional, pins the service type
 *   PCO_TIMEZONE              optional, overrides the timezone in pco-rules.json
 *
 * A `.env` in the Ontime data directory is read as well, because a packaged app has
 * no shell to export anything from. See `loadEnvFiles`.
 */

import {
  LogOrigin,
  type MaybeString,
  type PcoCredentialSource,
  type PcoCredentialsRequest,
  type PcoImportRequest,
  type PcoImportResult,
  type PcoKnownItems,
  type PcoPlanSheet,
  type PcoPlanSummary,
  type PcoRules,
  type PcoServiceTypeSummary,
  type PcoStatus,
} from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { existsSync } from 'fs';
import { join, resolve } from 'path';

import dotenv from 'dotenv';

import { logger } from '../../classes/Logger.js';
import { publicDir } from '../../setup/index.js';
import { patchCurrentProject } from '../project-service/ProjectService.js';
import { getCustomFields } from '../rundown-service/rundownCache.js';
import { getState } from '../../stores/runtimeState.js';
import { playbackBlocksRecall } from '../rundown-source-service/rundownSourceUtils.js';

import { PcoClient, PcoError, type PcoCredentials } from './PcoClient.js';
import {
  clearStoredCredentials,
  readStoredCredentials,
  writeStoredCredentials,
} from './pcoCredentialsFile.js';
import type { PcoItem, PcoServiceType } from './pcoTypes.js';
import { ensurePcoRulesFile, readPcoRules } from './pcoRulesFile.js';
import { buildRundownFromPlan, groupPlanTimesByDay, type PcoBuildResult } from './pcoRundownBuilder.js';
import {
  findPinnedBySourceName,
  knownItemsFromPlans,
  planSheetItems,
  maskCredentialId,
  pinnedSourceNames,
  planSourceName,
  planSummary,
  resolveServiceType,
} from './pcoSourceUtils.js';
import { localDateKey } from './pcoTime.js';
import { savePcoRules } from './pcoRulesFile.js';

/** how many upcoming plans the import tab lists per service type */
const PLANS_PER_SERVICE_TYPE = 8;

const missingCredentialsMessage =
  'Planning Center credentials are not set. Add PCO_APP_ID and PCO_SECRET from a Personal Access Token ' +
  'created at https://api.planningcenteronline.com/oauth/applications';

/**
 * The resolved service type, remembered so that listing plans does not re-read the
 * service type list on every refresh. Keyed by the configuration it was resolved
 * from, so editing pco-rules.json takes effect without a restart.
 */
let resolvedServiceType: { key: string; id: string; name: string } | null = null;

/**
 * The service type list, cached because it is the expensive call: this organisation
 * has 329 of them over four pages, and the settings panel wants the list to pick
 * from. They change about never.
 */
const SERVICE_TYPE_TTL = 10 * 60 * 1000;
let serviceTypeCache: { at: number; serviceTypes: PcoServiceType[] } | null = null;

export type PcoConfig = {
  rules: PcoRules;
  credentials: PcoCredentials | null;
  /** where the credentials came from, null when there are none */
  credentialSource: PcoCredentialSource | null;
  /** id pinned through the environment, which wins over the rules file */
  pinnedServiceTypeId: MaybeString;
};

/**
 * Files the credentials may come from, in the order they are tried.
 *
 * `dotenv/config` in app.ts only covers the working directory, which is the server
 * folder in development and something arbitrary in a packaged app. Neither is where
 * anyone would put the file:
 *
 * - the Ontime data directory, next to pco-rules.json, is the one that matters for
 *   an installed copy. There is no shell to export a variable from.
 * - the repository root is where the file sits in development.
 *
 * dotenv does not overwrite a variable that is already set, so a real environment
 * variable still wins over both.
 */
function loadEnvFiles(): void {
  if (envFilesLoaded) {
    return;
  }
  envFilesLoaded = true;

  const candidates = [join(publicDir.root, '.env'), resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path });
    }
  }
}

let envFilesLoaded = false;

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
  loadEnvFiles();

  const timezone = process.env.PCO_TIMEZONE;
  const applicationId = process.env.PCO_APP_ID;
  const secret = process.env.PCO_SECRET;

  /**
   * Saved credentials win over the environment.
   *
   * The panel is the operator's tool: a token typed there and saved has to take
   * effect, and silently deferring to a stale variable somebody exported months ago
   * would look like the save had failed. The status reports which source is in use,
   * so the precedence is visible rather than a surprise.
   */
  const stored = readStoredCredentials();
  const fromEnvironment = applicationId && secret ? { applicationId, secret } : null;
  const credentials = stored ?? fromEnvironment;

  if (credentials) {
    ensurePcoRulesFile();
  }
  const rules = readPcoRules();

  return {
    rules: timezone ? { ...rules, timezone } : rules,
    credentials,
    credentialSource: credentials ? (stored ? 'stored' : 'environment') : null,
    pinnedServiceTypeId: process.env.PCO_SERVICE_TYPE_ID || null,
  };
}

export function hasPcoCredentials(): boolean {
  return getPcoConfig().credentials !== null;
}

/**
 * Whether the pinned service types should be offered as rundown sources.
 *
 * Both halves are deliberate: `enabled` is the decision to answer recalls, the
 * credentials are the ability to. Being on takes nothing away from the linked
 * sheet -- both providers are listed.
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
  return [
    config.pinnedServiceTypeId,
    config.rules.serviceTypeId,
    config.rules.serviceTypeName,
    config.rules.pinnedServiceTypes.map((pinned) => pinned.id).join(','),
  ].join('|');
}

/** today's date in the organisation's timezone, which is what "next plan" is relative to */
function todayFor(config: PcoConfig): string {
  return localDateKey(new Date().toISOString(), config.rules.timezone);
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

  const serviceType = resolveServiceType(await listServiceTypesFor(client), {
    pinnedServiceTypeId: config.pinnedServiceTypeId,
    serviceTypeId: config.rules.serviceTypeId,
    serviceTypeName: config.rules.serviceTypeName,
    pinnedServiceTypes: config.rules.pinnedServiceTypes,
  });
  resolvedServiceType = { key, id: serviceType.id, name: serviceType.attributes.name };
  logger.info(LogOrigin.Server, `Planning Center service type ${serviceType.id} "${serviceType.attributes.name}"`);

  return resolvedServiceType;
}

/**
 * The recallable sources: one per pinned service type.
 *
 * Not one per plan. A button that says "Central AM" still means the right thing
 * next Sunday; a button holding a date is dead by Monday. Which plan it resolves to
 * is decided at recall time, in `fetchPcoSource`.
 */
export async function listPcoSources(): Promise<string[]> {
  return pinnedSourceNames(getPcoConfig().rules.pinnedServiceTypes);
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

  const pinned = findPinnedBySourceName(config.rules.pinnedServiceTypes, name);
  if (!pinned) {
    throw new PcoError(
      `No Planning Center service type named "${name}" is pinned. ` +
        `Available: ${pinnedSourceNames(config.rules.pinnedServiceTypes).join(', ') || 'none'}`,
    );
  }

  // the soonest plan from today, so a Sunday morning recall loads that morning
  const from = todayFor(config);
  const [plan] = await client.getPlansFrom(pinned.id, from, 1);

  if (!plan) {
    throw new PcoError(`"${pinned.name}" has no plan on or after ${from}`);
  }

  logger.info(LogOrigin.Server, `Planning Center "${pinned.name}" resolved to the plan on ${planSourceName(plan)}`);

  const [planTimes, content] = await Promise.all([
    client.getPlanTimes(pinned.id, plan.id),
    client.getPlanContent(pinned.id, plan.id),
  ]);

  const result = buildRundownFromPlan({
    plan,
    planTimes,
    items: content.items,
    itemTimes: content.itemTimes,
    rules: config.rules,
    serviceTypeId: pinned.id,
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

/** Drops the cached service type and service type list, so the next call re-reads */
export function resetPcoCache(): void {
  resolvedServiceType = null;
  serviceTypeCache = null;
}

/* -------------------------------------------------------------------------- */
/* what the settings panel calls                                               */
/* -------------------------------------------------------------------------- */

/** The service type list, from cache when it is fresh */
async function listServiceTypesFor(client: PcoClient): Promise<PcoServiceType[]> {
  if (serviceTypeCache && Date.now() - serviceTypeCache.at < SERVICE_TYPE_TTL) {
    return serviceTypeCache.serviceTypes;
  }
  const serviceTypes = await client.getServiceTypes();
  serviceTypeCache = { at: Date.now(), serviceTypes };
  return serviceTypes;
}

/**
 * Every service type in the organisation, for the picker.
 * Sorted by name because PCO returns them in creation order, which is meaningless
 * once there are hundreds.
 */
export async function listPcoServiceTypes(): Promise<PcoServiceTypeSummary[]> {
  const config = getPcoConfig();
  const serviceTypes = await listServiceTypesFor(getClient(config));

  return serviceTypes
    .map((serviceType) => ({ id: serviceType.id, name: serviceType.attributes.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether the connector is usable and what it is pointed at.
 *
 * Resolving the service type is a live call, so a failure here is the honest answer
 * to "is this working" rather than something to throw.
 */
export async function getPcoStatus(): Promise<PcoStatus> {
  const config = getPcoConfig();

  const status: PcoStatus = {
    hasCredentials: config.credentials !== null,
    credentialSource: config.credentialSource,
    applicationIdHint: config.credentials ? maskCredentialId(config.credentials.applicationId) : null,
    enabled: config.rules.enabled,
    connected: false,
    serviceTypeCount: null,
    serviceType: null,
    error: null,
  };

  if (!config.credentials) {
    return { ...status, error: missingCredentialsMessage };
  }

  const client = getClient(config);

  // reaching the API is the connection test; anything after it is configuration
  let serviceTypeCount: number;
  try {
    serviceTypeCount = (await listServiceTypesFor(client)).length;
  } catch (error) {
    return { ...status, error: getErrorMessage(error) };
  }

  const connected = { ...status, connected: true, serviceTypeCount };

  try {
    const serviceType = await useServiceType(client, config);
    return { ...connected, serviceType: { id: serviceType.id, name: serviceType.name.trim() } };
  } catch {
    // nothing chosen yet, or the choice no longer exists. The panel says so itself
    return connected;
  }
}

/**
 * Upcoming plans across the given service types, or across the pinned ones.
 *
 * Failures are per service type: a pinned type that has been archived should not
 * take the whole list down, so it is logged and skipped.
 */
export async function listPcoPlans(
  serviceTypeIds?: string[],
  perServiceType = PLANS_PER_SERVICE_TYPE,
): Promise<PcoPlanSummary[]> {
  const config = getPcoConfig();
  const client = getClient(config);

  const wanted = serviceTypeIds?.length
    ? serviceTypeIds
    : config.rules.pinnedServiceTypes.map((pinned) => pinned.id);

  if (wanted.length === 0) {
    return [];
  }

  const serviceTypes = await listServiceTypesFor(client);
  const summaries: PcoPlanSummary[] = [];

  const from = todayFor(config);

  for (const serviceTypeId of wanted) {
    const serviceType = serviceTypes.find((candidate) => candidate.id === serviceTypeId);
    if (!serviceType) {
      logger.warning(LogOrigin.Server, `Planning Center service type ${serviceTypeId} no longer exists`);
      continue;
    }

    try {
      const plans = await client.getPlansFrom(serviceTypeId, from, perServiceType);
      for (const plan of plans) {
        summaries.push(planSummary(plan, { id: serviceTypeId, name: serviceType.attributes.name }));
      }
    } catch (error) {
      logger.warning(
        LogOrigin.Server,
        `Could not read plans for "${serviceType.attributes.name.trim()}": ${getErrorMessage(error)}`,
      );
    }
  }

  // soonest first across every service type, so a Sunday's services sit together
  return summaries.sort((a, b) => a.date.localeCompare(b.date) || a.serviceTypeName.localeCompare(b.serviceTypeName));
}

/**
 * The distinct item titles a service type's run sheets use, with the rule that
 * currently claims each one.
 *
 * Sampling several plans rather than one is deliberate: a single week is missing
 * whatever did not happen that week, and the panel is for configuring the usual.
 */
export async function getPcoKnownItems(serviceTypeId?: string, plansToSample = 4): Promise<PcoKnownItems> {
  const config = getPcoConfig();
  const client = getClient(config);
  const serviceType = serviceTypeId
    ? (await listServiceTypesFor(client)).find((candidate) => candidate.id === serviceTypeId)
    : undefined;

  const resolved = serviceType
    ? { id: serviceType.id, name: serviceType.attributes.name.trim() }
    : await useServiceType(client, config);

  const plans = await client.getPlansFrom(resolved.id, todayFor(config), plansToSample);
  const contents: PcoItem[][] = [];

  for (const plan of plans) {
    try {
      const { items } = await client.getPlanContent(resolved.id, plan.id);
      contents.push(items);
    } catch (error) {
      logger.warning(LogOrigin.Server, `Could not read plan ${plan.id}: ${getErrorMessage(error)}`);
    }
  }

  return {
    serviceTypeId: resolved.id,
    serviceTypeName: resolved.name,
    plansSampled: contents.length,
    items: knownItemsFromPlans(contents, config.rules),
  };
}

/**
 * One plan's run sheet, resolved through the rules as the import will resolve it.
 *
 * This is what the import page lists. It reads a single named plan rather than
 * sampling the next few, because the person looking at it is about to import that
 * plan and wants to see the morning, not a summary of the mornings like it.
 */
export async function getPcoPlanSheet(serviceTypeId: string, planId: string): Promise<PcoPlanSheet> {
  const config = getPcoConfig();
  const client = getClient(config);

  const serviceType = (await listServiceTypesFor(client)).find((candidate) => candidate.id === serviceTypeId);
  if (!serviceType) {
    throw new PcoError(`No Planning Center service type with id ${serviceTypeId}`);
  }

  const plan = await client.getPlan(serviceTypeId, planId);
  const [planTimes, content] = await Promise.all([
    client.getPlanTimes(serviceTypeId, plan.id),
    client.getPlanContent(serviceTypeId, plan.id),
  ]);

  /**
   * The day the rundown would be built for. It decides which rehearsal times are
   * listed -- a plan routinely carries a midweek one, and that morning is not the
   * one being imported.
   */
  const days = groupPlanTimesByDay(planTimes, config.rules.timezone);
  const buildDay = days.find((day) => day.serviceTimes.length > 0);

  return {
    serviceTypeId,
    serviceTypeName: serviceType.attributes.name.trim(),
    planId: plan.id,
    planTitle: plan.attributes.title ?? '',
    dates: plan.attributes.dates ?? '',
    // a plan often carries a midweek rehearsal, and only a day with services can be built
    availableDays: days.map((day) => ({
      dateKey: day.dateKey,
      label: day.label,
      hasServices: day.serviceTimes.length > 0,
    })),
    items: planSheetItems(content.items, config.rules, serviceTypeId, buildDay),
  };
}

/**
 * Builds one plan and replaces the project's rundown with it.
 *
 * The same destructive operation as a recall or a sheet import, so it carries the
 * same refusal: not while a show is running.
 */
export async function importPcoPlan(request: PcoImportRequest): Promise<PcoImportResult> {
  const { playback } = getState().timer;
  if (playbackBlocksRecall(playback)) {
    throw new Error(`Refusing to import while playback is ${playback}, stop playback first`);
  }

  const config = getPcoConfig();
  const client = getClient(config);

  const plan = await client.getPlan(request.serviceTypeId, request.planId);
  const [planTimes, content] = await Promise.all([
    client.getPlanTimes(request.serviceTypeId, plan.id),
    client.getPlanContent(request.serviceTypeId, plan.id),
  ]);

  const result = buildRundownFromPlan({
    plan,
    planTimes,
    items: content.items,
    itemTimes: content.itemTimes,
    rules: config.rules,
    targetDate: request.targetDate,
    serviceTypeId: request.serviceTypeId,
  });

  // replaces the rundown, stops playback and regenerates the mirrored service
  await patchCurrentProject({
    rundown: result.rundown,
    customFields: getCustomFields(),
    serviceProfiles: result.serviceProfiles,
  });

  logger.info(
    LogOrigin.Server,
    `Imported Planning Center plan ${plan.id} (${result.day.dateKey}) with ${result.rundown.length} entries`,
  );
  for (const warning of result.warnings) {
    logger.warning(LogOrigin.Server, `Planning Center: ${warning}`);
  }

  return {
    planId: plan.id,
    date: result.day.dateKey,
    entries: result.rundown.length,
    warnings: result.warnings,
  };
}

/**
 * Writes the rules and drops the caches the change could invalidate.
 * The whole object is written, because that is what the panel holds.
 */
export function setPcoRules(rules: PcoRules): PcoRules {
  savePcoRules(rules);
  resetPcoCache();
  return getPcoConfig().rules;
}

/**
 * Checks a token pair against Planning Center, then saves it.
 *
 * Verified before it is written on purpose: a typo in a token is invisible -- there
 * is nothing to look at afterwards to tell whether it was right -- and saving a bad
 * pair would leave the panel reporting credentials that cannot be used.
 * @throws when Planning Center rejects the pair, in which case nothing is written
 */
export async function setPcoCredentials(request: PcoCredentialsRequest): Promise<void> {
  const applicationId = request.applicationId.trim();
  const secret = request.secret.trim();

  if (!applicationId || !secret) {
    throw new PcoError('Both the application id and the secret are required', 400);
  }

  await new PcoClient({ applicationId, secret }).checkAuth();

  writeStoredCredentials({ applicationId, secret });
  resetPcoCache();
}

/**
 * Forgets the saved pair. Any pair in the environment takes over again, which the
 * status reports, so removing here does not necessarily leave the connector unusable.
 */
export function removePcoCredentials(): void {
  clearStoredCredentials();
  resetPcoCache();
}

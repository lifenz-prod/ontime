/**
 * Verification harness for the Planning Center connector.
 *
 * Pulls a real plan and prints the rundown it would generate, plus the mirrored
 * second service, so the whole path can be checked against an actual run sheet
 * before any of it is wired into the app.
 *
 * Credentials come from the environment and are never written to disk:
 *   export PCO_APP_ID=...      # Application ID
 *   export PCO_SECRET=...      # Secret
 * Create the pair at https://api.planningcenteronline.com/oauth/applications
 * under "Personal Access Tokens".
 *
 * Usage, from apps/server:
 *   pnpm tsx src/services/pco-service/dev/pcoProbe.ts
 *   pnpm tsx src/services/pco-service/dev/pcoProbe.ts --service-type "Central AM"
 *   pnpm tsx src/services/pco-service/dev/pcoProbe.ts --service-type "Central AM" --day 2026-08-23
 *   pnpm tsx src/services/pco-service/dev/pcoProbe.ts --plan 71234567 --rules ./my-rules.json
 *   pnpm tsx src/services/pco-service/dev/pcoProbe.ts --raw          # dump the API payloads
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import dotenv from 'dotenv';

import { isOntimeBlock, isOntimeEvent, OntimeRundown, OntimeRundownEntry, ServiceProfiles } from 'ontime-types';
import { millisToString } from 'ontime-utils';

import { regenerateInstances } from '../../rundown-service/serviceInstanceUtils.js';
import { PcoClient, PcoError } from '../PcoClient.js';
import { buildRundownFromPlan, groupPlanTimesByDay } from '../pcoRundownBuilder.js';
import { defaultPcoRules, mergePcoRules, type PcoRules } from '../pcoRules.js';

/* ---------------------------------------------------------------- arguments */

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));

// credentials come from .env at the repo root or the server directory;
// anything already in the environment wins
for (const candidate of ['.env', '../../.env']) {
  dotenv.config({ path: resolve(process.cwd(), candidate) });
}

/* ------------------------------------------------------------------ display */

/** run sheets carry seconds (8:58:20), so they are never trimmed away */
const clock = (ms: number): string => millisToString(ms);

function printRundown(rundown: OntimeRundown, label: string): void {
  console.log(`\n${label}`);
  console.log('-'.repeat(label.length));

  for (const entry of rundown) {
    if (isOntimeBlock(entry)) {
      console.log(`\n  == ${entry.title || '(untitled block)'} ==`);
      continue;
    }
    if (!isOntimeEvent(entry)) {
      console.log(`     [delay]`);
      continue;
    }
    const kind = entry.countToEnd ? 'to-time' : entry.timerType;
    console.log(
      `  ${entry.cue.padStart(3)}  ${clock(entry.timeStart)}-${clock(entry.timeEnd)}  ` +
        `${millisToString(entry.duration).padStart(8)}  ${kind.padEnd(9)}  ${entry.title}`,
    );
  }
}

function printProfiles(profiles: ServiceProfiles, rundown: OntimeRundown): void {
  console.log('\nService profiles');
  console.log('----------------');
  const boundary = rundown.find((entry: OntimeRundownEntry) => entry.id === profiles.boundaryBlockId);
  console.log(
    `  boundary block: ${profiles.boundaryBlockId ?? '(none)'} "${boundary && isOntimeBlock(boundary) ? boundary.title : '?'}"`,
  );
  for (const service of profiles.services) {
    console.log(`  ${service.name.padEnd(8)} offset ${millisToString(service.offset)}`);
  }
}

/* --------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const applicationId = process.env.PCO_APP_ID;
  const secret = process.env.PCO_SECRET;

  if (!applicationId || !secret) {
    console.error(
      'Missing credentials. Set PCO_APP_ID and PCO_SECRET from a Personal Access Token\n' +
        'created at https://api.planningcenteronline.com/oauth/applications',
    );
    process.exit(1);
  }

  let rules: PcoRules = defaultPcoRules;
  if (typeof args.rules === 'string') {
    rules = mergePcoRules(JSON.parse(readFileSync(args.rules, 'utf-8')));
    console.log(`Rules loaded from ${args.rules}`);
  }
  const timezone = typeof args.timezone === 'string' ? args.timezone : process.env.PCO_TIMEZONE;
  if (timezone) {
    rules = { ...rules, timezone };
  }

  const client = new PcoClient({ applicationId, secret });

  /* 1. which service type */
  const serviceTypes = await client.getServiceTypes();
  console.log(`\nService types (${serviceTypes.length})`);
  console.log('-------------');
  for (const serviceType of serviceTypes) {
    console.log(`  ${serviceType.id.padEnd(10)} ${serviceType.attributes.name}`);
  }

  const pinnedId =
    typeof args['service-type-id'] === 'string' ? args['service-type-id'] : process.env.PCO_SERVICE_TYPE_ID;
  const wanted = typeof args['service-type'] === 'string' ? args['service-type'].toLowerCase() : null;
  const serviceType = pinnedId
    ? serviceTypes.find((candidate) => candidate.id === pinnedId)
    : wanted
      ? serviceTypes.find((candidate) => candidate.attributes.name.toLowerCase().includes(wanted))
      : serviceTypes[0];

  if (!serviceType) {
    console.error(`\nNo service type matching "${pinnedId ?? args['service-type']}". Pick one of the ids above.`);
    process.exit(1);
  }
  console.log(`\nUsing service type ${serviceType.id} "${serviceType.attributes.name}"`);

  /* 2. which plan */
  const plans = await client.getFuturePlans(serviceType.id, 5);
  console.log(`\nUpcoming plans (${plans.length})`);
  console.log('--------------');
  for (const candidate of plans) {
    console.log(
      `  ${candidate.id.padEnd(10)} ${candidate.attributes.dates ?? '?'}  ` +
        `${candidate.attributes.title ?? ''} ${candidate.attributes.series_title ? `[${candidate.attributes.series_title}]` : ''}`,
    );
  }

  const plan = typeof args.plan === 'string' ? await client.getPlan(serviceType.id, args.plan) : plans[0];

  if (!plan) {
    console.error('\nNo upcoming plan found for this service type.');
    process.exit(1);
  }
  console.log(`\nUsing plan ${plan.id} "${plan.attributes.title ?? ''}" (${plan.attributes.dates ?? '?'})`);

  /* 3. times, items, per-time overrides */
  const planTimes = await client.getPlanTimes(serviceType.id, plan.id);
  const items = await client.getItems(serviceType.id, plan.id);
  const itemTimes = await client.getItemTimes(serviceType.id, plan.id, items);

  console.log(`\nPlan times (${planTimes.length})`);
  console.log('----------');
  for (const day of groupPlanTimesByDay(planTimes, rules.timezone)) {
    console.log(`  ${day.label}`);
    for (const time of day.times) {
      console.log(
        `      ${time.attributes.time_type.padEnd(9)} ${time.attributes.starts_at} -> ${time.attributes.ends_at ?? '?'}  ${time.attributes.name ?? ''}`,
      );
    }
  }

  console.log(`\nItems (${items.length}), item times (${itemTimes.length})`);
  console.log('-----');
  for (const item of items) {
    console.log(
      `  ${String(item.attributes.sequence ?? '').padStart(3)}  ${String(item.attributes.length ?? 0).padStart(5)}s  ` +
        `${item.attributes.item_type.padEnd(6)} ${item.attributes.service_position.padEnd(6)} ${item.attributes.title ?? ''}`,
    );
  }

  if (args.raw) {
    const target = typeof args.raw === 'string' ? args.raw : 'pco-raw.json';
    writeFileSync(target, JSON.stringify({ plan, planTimes, items, itemTimes }, null, 2));
    console.log(`\nRaw payloads written to ${target}`);
  }

  /* 4. build */
  const result = buildRundownFromPlan({
    plan,
    planTimes,
    items,
    itemTimes,
    rules,
    targetDate: typeof args.day === 'string' ? args.day : undefined,
  });

  console.log('\nWarnings');
  console.log('--------');
  for (const warning of result.warnings) {
    console.log(`  - ${warning}`);
  }

  printRundown(result.rundown, `Generated rundown for ${result.day.dateKey} (PRE + master)`);
  printProfiles(result.serviceProfiles, result.rundown);

  const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);
  printRundown(mirrored, `After the dual-service mirror (${mirrored.length} entries total)`);
}

main().catch((error) => {
  if (error instanceof PcoError) {
    console.error(`\nPlanning Center error: ${error.message}`);
  } else {
    console.error(`\n${error instanceof Error ? error.stack : String(error)}`);
  }
  process.exit(1);
});

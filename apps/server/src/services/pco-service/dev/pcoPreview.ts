/**
 * Offline preview of the connector, built from the Central AM fixture.
 * No credentials needed -- useful for seeing the output shape and for checking
 * a rules file before pointing it at the real API.
 *
 * From apps/server:
 *   pnpm tsx src/services/pco-service/dev/pcoPreview.ts
 *   pnpm tsx src/services/pco-service/dev/pcoPreview.ts --rules ./my-rules.json
 */

import { readFileSync } from 'fs';

import { isOntimeBlock, isOntimeEvent, OntimeRundown } from 'ontime-types';
import { millisToString } from 'ontime-utils';

import { regenerateInstances } from '../../rundown-service/serviceInstanceUtils.js';
import { items, itemTimes, plan, planTimes } from '../__tests__/fixtures/centralAm.js';
import { buildRundownFromPlan } from '../pcoRundownBuilder.js';
import { defaultPcoRules, mergePcoRules, type PcoRules } from '../pcoRules.js';

/** run sheets carry seconds (8:58:20), so they are never trimmed away */
const clock = (ms: number): string => millisToString(ms);

function show(rundown: OntimeRundown, label: string): void {
  console.log(`\n${label}\n${'-'.repeat(label.length)}`);
  for (const entry of rundown) {
    if (isOntimeBlock(entry)) {
      console.log(`\n  == ${entry.title || '(untitled)'} ==`);
    } else if (isOntimeEvent(entry)) {
      const kind = entry.countToEnd ? 'to-time' : entry.timerType;
      console.log(
        `  ${entry.cue.padStart(3)}  ${clock(entry.timeStart)}-${clock(entry.timeEnd)}  ` +
          `${millisToString(entry.duration).padStart(8)}  ${kind.padEnd(9)}  ${entry.title}`,
      );
    }
  }
}

const rulesArg = process.argv.indexOf('--rules');
const rules: PcoRules =
  rulesArg > -1 && process.argv[rulesArg + 1]
    ? mergePcoRules(JSON.parse(readFileSync(process.argv[rulesArg + 1], 'utf-8')))
    : defaultPcoRules;

const result = buildRundownFromPlan({ plan, planTimes, items, itemTimes, rules });

console.log('WARNINGS');
console.log('--------');
for (const warning of result.warnings) {
  console.log(`  - ${warning}`);
}

console.log('\nDAYS ON THIS PLAN');
console.log('-----------------');
for (const day of result.availableDays) {
  console.log(`  ${day.dateKey}  ${day.serviceTimes.length} service, ${day.otherTimes.length} other  ${day.label}`);
}

show(result.rundown, `IMPORTED (${result.day.dateKey}) -- PRE + master`);

console.log('\nSERVICE PROFILES');
console.log('----------------');
for (const service of result.serviceProfiles.services) {
  console.log(`  ${service.name.padEnd(6)} offset ${millisToString(service.offset)}`);
}

show(regenerateInstances(result.rundown, result.serviceProfiles), 'AFTER THE EXISTING DUAL-SERVICE MIRROR');

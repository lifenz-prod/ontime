/**
 * Reads the Planning Center rules from disk.
 *
 * Kept apart from pcoRules.ts so the rule logic stays pure and testable, and so
 * importing the builder never drags the filesystem in. The file is seeded from
 * the defaults on first read, which gives a working document to edit rather than
 * an empty one to invent.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { LogOrigin, type PcoRules } from 'ontime-types';

import { logger } from '../../classes/Logger.js';
import { publicDir } from '../../setup/index.js';

import { defaultPcoRules, mergePcoRules } from './pcoRules.js';

export const pcoRulesPath = join(publicDir.root, 'pco-rules.json');

/**
 * The file this seeds holds ONLY the keys somebody has to decide -- the switch and
 * the service type. Everything absent from it follows the shipped defaults.
 *
 * Writing a full snapshot of `defaultPcoRules` instead would be a trap: the file is
 * merged over the defaults, so the snapshot would freeze them at the version which
 * created it, and no rule shipped later could ever reach an existing installation.
 */
const seedRules = {
  '//': 'Only the keys set here are used; anything absent follows the defaults shipped with Ontime, which change between versions. See pco-rules.example.json in the source for every available option.',
  enabled: false,
  serviceTypeId: null,
  serviceTypeName: null,
};

/** Writes the switches out so there is always something to edit */
export function ensurePcoRulesFile(): string {
  if (!existsSync(pcoRulesPath)) {
    writeFileSync(pcoRulesPath, `${JSON.stringify(seedRules, null, 2)}\n`, 'utf-8');
    logger.info(LogOrigin.Server, `Created Planning Center rules at ${pcoRulesPath}`);
  }
  return pcoRulesPath;
}

/**
 * Reads the rules without creating anything.
 *
 * Separate from `loadPcoRules` because the rundown source provider asks whether
 * Planning Center is enabled on every refresh, and that question must not leave a
 * config file behind in the data directory of somebody who does not use PCO.
 */
export function readPcoRules(): PcoRules {
  if (!existsSync(pcoRulesPath)) {
    return { ...defaultPcoRules };
  }
  return loadPcoRules();
}

/**
 * Loads the rules, seeding and falling back to the defaults on a missing or
 * malformed file. A bad file is logged rather than thrown, so a typo cannot take
 * the server down.
 */
export function loadPcoRules(): PcoRules {
  try {
    ensurePcoRulesFile();
    return mergePcoRules(JSON.parse(readFileSync(pcoRulesPath, 'utf-8')));
  } catch (error) {
    logger.error(
      LogOrigin.Server,
      `Could not read Planning Center rules at ${pcoRulesPath}, using defaults: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ...defaultPcoRules };
  }
}

/** structural equality, so a key is only persisted when it really differs */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  return [...keys].every((key) => sameValue(left[key], right[key]));
}

/**
 * Writes only what differs from the shipped defaults.
 *
 * The file is merged over `defaultPcoRules` when read, so persisting the whole
 * object would freeze the defaults at the version that saved it: a rule shipped
 * later could never reach anyone who had ever opened the settings panel. Keeping
 * the file to actual deviations means new defaults keep arriving.
 *
 * The trade-off is deliberate: choosing a value which happens to equal today's
 * default records nothing, so if that default later changes, the choice changes
 * with it. For a house style expressed as defaults, following them is the more
 * useful behaviour -- and a value nobody ever set silently going stale is worse.
 */
export function savePcoRules(rules: PcoRules): void {
  const deviations: Record<string, unknown> = {
    '//': seedRules['//'],
  };

  for (const key of Object.keys(defaultPcoRules) as (keyof PcoRules)[]) {
    if (!sameValue(rules[key], defaultPcoRules[key])) {
      deviations[key] = rules[key];
    }
  }

  writeFileSync(pcoRulesPath, `${JSON.stringify(deviations, null, 2)}\n`, 'utf-8');
}

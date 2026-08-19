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

import { LogOrigin } from 'ontime-types';

import { logger } from '../../classes/Logger.js';
import { publicDir } from '../../setup/index.js';

import { defaultPcoRules, mergePcoRules, type PcoRules } from './pcoRules.js';

export const pcoRulesPath = join(publicDir.root, 'pco-rules.json');

/** Writes the defaults out so there is always something to edit */
export function ensurePcoRulesFile(): string {
  if (!existsSync(pcoRulesPath)) {
    writeFileSync(pcoRulesPath, `${JSON.stringify(defaultPcoRules, null, 2)}\n`, 'utf-8');
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

export function savePcoRules(rules: PcoRules): void {
  writeFileSync(pcoRulesPath, `${JSON.stringify(rules, null, 2)}\n`, 'utf-8');
}

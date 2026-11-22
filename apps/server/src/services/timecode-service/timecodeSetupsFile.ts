/**
 * Reads and writes the saved timecode setups.
 *
 * The library lives in the app data folder, beside pco-rules.json, rather than in a
 * project file, so a setup saved in one project can be recalled into any other.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { LogOrigin, type TimecodeSetup } from 'ontime-types';

import { logger } from '../../classes/Logger.js';
import { publicDir } from '../../setup/index.js';

import { parseTimecodeSetups, sortSetups } from './timecodeSetups.js';

export const timecodeSetupsPath = join(publicDir.root, 'timecode-setups.json');

/**
 * Loads the library. A missing file is an empty library; a bad one is logged rather than thrown,
 * so a hand edit gone wrong cannot take the server down.
 */
export function loadTimecodeSetups(): TimecodeSetup[] {
  if (!existsSync(timecodeSetupsPath)) {
    return [];
  }
  try {
    return sortSetups(parseTimecodeSetups(JSON.parse(readFileSync(timecodeSetupsPath, 'utf-8'))));
  } catch (error) {
    logger.error(
      LogOrigin.Server,
      `Could not read timecode setups at ${timecodeSetupsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

export function saveTimecodeSetups(setups: TimecodeSetup[]): void {
  writeFileSync(timecodeSetupsPath, `${JSON.stringify(setups, null, 2)}\n`, 'utf-8');
}

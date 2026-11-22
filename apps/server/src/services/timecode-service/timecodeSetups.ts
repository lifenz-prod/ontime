/**
 * The library of saved timecode timer setups.
 *
 * The rules (reading, saving by name, deleting) are pure and testable here;
 * timecodeSetupsFile.ts does the disk work.
 */

import type { TimecodeSetup, TimecodeTimer } from 'ontime-types';
import { generateId } from 'ontime-utils';

import { parseTimecodeTimers } from '../../api-data/timecode/timecode.parser.js';

export const maxSetupNameLength = 60;

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** Reads a stored library, dropping anything malformed rather than failing the whole list */
export function parseTimecodeSetups(data: unknown): TimecodeSetup[] {
  const list = Array.isArray(data) ? data : [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, name, timers, savedAt } = entry as Partial<Record<keyof TimecodeSetup, unknown>>;
    if (typeof name !== 'string' || name.trim() === '') return [];
    return [
      {
        id: typeof id === 'string' && id !== '' ? id : generateId(),
        name: name.trim().slice(0, maxSetupNameLength),
        timers: parseTimecodeTimers(timers),
        savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
      },
    ];
  });
}

/**
 * Saves timers under a name. A setup with the same name (ignoring case) is replaced in place,
 * keeping its id, so saving again updates it rather than making a second copy.
 */
export function upsertTimecodeSetup(
  setups: TimecodeSetup[],
  name: string,
  timers: TimecodeTimer[],
  now = Date.now(),
): { setups: TimecodeSetup[]; saved: TimecodeSetup } {
  const trimmed = name.trim().slice(0, maxSetupNameLength);
  if (trimmed === '') {
    throw new Error('A setup needs a name');
  }

  const existing = setups.find((setup) => sameName(setup.name, trimmed));
  const saved: TimecodeSetup = {
    id: existing?.id ?? generateId(),
    name: trimmed,
    timers: parseTimecodeTimers(timers),
    savedAt: now,
  };

  const next = existing ? setups.map((setup) => (setup.id === existing.id ? saved : setup)) : [...setups, saved];
  return { setups: sortSetups(next), saved };
}

export function removeTimecodeSetup(setups: TimecodeSetup[], id: string): TimecodeSetup[] {
  return setups.filter((setup) => setup.id !== id);
}

/** Alphabetical, so the list reads the same however it was built */
export function sortSetups(setups: TimecodeSetup[]): TimecodeSetup[] {
  return [...setups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

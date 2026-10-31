import {
  isOntimeEvent,
  OntimeBlock,
  OntimeEvent,
  OntimeRundown,
  OntimeRundownEntry,
  ServiceProfiles,
  SupportedEvent,
} from 'ontime-types';
import { dayInMs, generateId, MILLIS_PER_MINUTE } from 'ontime-utils';

/** a blank cue is added this long before each generated section's first cue (doors open) */
export const LEAD_IN_DURATION = 15 * MILLIS_PER_MINUTE;
const LEAD_IN_KEY = 'lead-in';

/** identifies a generated entry across regenerations: its service and the master entry it mirrors */
function getMirrorKey(serviceId: string, mirrorOf: string | undefined): string {
  return `${serviceId}/${mirrorOf ?? LEAD_IN_KEY}`;
}

/**
 * Removes all generated service-instance entries from a rundown
 */
export function stripGeneratedEntries(rundown: OntimeRundown): OntimeRundown {
  return rundown.filter((entry) => !entry.generatedFor);
}

/**
 * Rebuilds the generated service sections from the master section
 * The master section spans from the boundary block to the end of the (stripped) rundown
 * Each service after the first is materialised as a block named after the service
 * followed by clones of the master entries, time-shifted by the service offset
 * A blank lead-in cue is added before the section's first cue, so there is something to count down to doors open
 * Generated entries edited by hand (deviated) are kept as they are instead of being re-cloned
 */
export function regenerateInstances(rundown: OntimeRundown, serviceProfiles: ServiceProfiles): OntimeRundown {
  const strippedRundown = stripGeneratedEntries(rundown);

  // hand-edited generated entries survive regeneration
  const deviatedEntries = new Map<string, OntimeRundownEntry>();
  // previous generated id -> the key it is known by, to re-point links into kept entries
  const previousKeys = new Map<string, string>();
  for (const entry of rundown) {
    if (!entry.generatedFor) continue;
    const key = getMirrorKey(entry.generatedFor, entry.mirrorOf);
    previousKeys.set(entry.id, key);
    if (entry.deviated) {
      deviatedEntries.set(key, entry);
    }
  }

  const { boundaryBlockId, services } = serviceProfiles;
  if (!boundaryBlockId || services.length < 2) {
    return strippedRundown;
  }

  const boundaryIndex = strippedRundown.findIndex((entry) => entry.id === boundaryBlockId);
  if (boundaryIndex < 0) {
    return strippedRundown;
  }

  // master section is everything after the boundary block
  const masterEntries = strippedRundown.slice(boundaryIndex + 1);
  if (masterEntries.length === 0) {
    return strippedRundown;
  }

  const usedIds = new Set(strippedRundown.map((entry) => entry.id));
  for (const entry of deviatedEntries.values()) {
    usedIds.add(entry.id);
  }
  const getUniqueId = (): string => {
    let id = '';
    do {
      id = generateId();
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  const generatedEntries: OntimeRundownEntry[] = [];

  // the first service is the authored master, all others are generated
  // the cue that hands over into the generated section, its end action keeps the chain running through the lead-in
  const lastMasterEvent = masterEntries.findLast(isOntimeEvent);

  for (const service of services.slice(1)) {
    // key -> id of this section's entry, to re-point links
    const keyToId = new Map<string, string>();

    const sectionBlock: OntimeBlock = {
      type: SupportedEvent.Block,
      id: getUniqueId(),
      title: service.name,
      generatedFor: service.id,
      mirrorOf: boundaryBlockId,
    };
    generatedEntries.push(sectionBlock);

    const sectionEntries: OntimeRundownEntry[] = [];
    // links that pointed at the master (clones) or at the previous generation (kept entries), by key
    const linkKeys = new Map<OntimeEvent, string | undefined>();

    for (const masterEntry of masterEntries) {
      const key = getMirrorKey(service.id, masterEntry.id);
      const kept = deviatedEntries.get(key);
      if (kept) {
        const entry = structuredClone(kept);
        keyToId.set(key, entry.id);
        if (isOntimeEvent(entry) && entry.linkStart !== null) {
          linkKeys.set(entry, previousKeys.get(entry.linkStart));
        }
        sectionEntries.push(entry);
        continue;
      }

      const clone = structuredClone(masterEntry) as OntimeRundownEntry;
      clone.id = getUniqueId();
      clone.generatedFor = service.id;
      clone.mirrorOf = masterEntry.id;
      keyToId.set(key, clone.id);

      if (isOntimeEvent(clone)) {
        clone.timeStart = (clone.timeStart + service.offset) % dayInMs;
        clone.timeEnd = (clone.timeEnd + service.offset) % dayInMs;
        if (clone.linkStart !== null) {
          linkKeys.set(clone, getMirrorKey(service.id, clone.linkStart));
        }
      }
      sectionEntries.push(clone);
    }

    const firstEventIndex = sectionEntries.findIndex(isOntimeEvent);
    if (firstEventIndex >= 0) {
      const leadInKey = getMirrorKey(service.id, undefined);
      const leadIn =
        structuredClone(deviatedEntries.get(leadInKey)) ??
        makeLeadIn(sectionEntries[firstEventIndex] as OntimeEvent, lastMasterEvent, getUniqueId(), service.id);
      keyToId.set(leadInKey, leadIn.id);
      sectionEntries.splice(firstEventIndex, 0, leadIn);
    }

    // re-point links to this section's counterparts
    // links that point outside the section (eg into the master) are removed
    // so that the section is not dragged back to the master's end
    for (const [entry, linkKey] of linkKeys) {
      entry.linkStart = (linkKey && keyToId.get(linkKey)) || null;
    }

    generatedEntries.push(...sectionEntries);
  }

  return [...strippedRundown, ...generatedEntries];
}

/**
 * A blank cue ending when the section's first cue (doors open) starts
 * Takes its timer setup from that cue, and its end action from the cue that hands over into the section
 */
function makeLeadIn(
  firstEvent: OntimeEvent,
  handoverEvent: OntimeEvent | undefined,
  id: string,
  serviceId: string,
): OntimeEvent {
  return {
    ...structuredClone(firstEvent),
    id,
    generatedFor: serviceId,
    mirrorOf: undefined,
    deviated: undefined,
    cue: '',
    title: '',
    note: '',
    colour: '',
    custom: {},
    triggers: [],
    linkStart: null,
    endAction: handoverEvent?.endAction ?? firstEvent.endAction,
    timeStart: (firstEvent.timeStart - LEAD_IN_DURATION + dayInMs) % dayInMs,
    timeEnd: firstEvent.timeStart,
    duration: LEAD_IN_DURATION,
    revision: 0,
  };
}

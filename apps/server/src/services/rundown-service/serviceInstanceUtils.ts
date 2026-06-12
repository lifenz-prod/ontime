import { isOntimeEvent, OntimeBlock, OntimeRundown, OntimeRundownEntry, ServiceProfiles, SupportedEvent } from 'ontime-types';
import { dayInMs, generateId } from 'ontime-utils';

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
 */
export function regenerateInstances(rundown: OntimeRundown, serviceProfiles: ServiceProfiles): OntimeRundown {
  const strippedRundown = stripGeneratedEntries(rundown);

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
  for (const service of services.slice(1)) {
    const idMap = new Map<string, string>();

    const sectionBlock: OntimeBlock = {
      type: SupportedEvent.Block,
      id: getUniqueId(),
      title: service.name,
      generatedFor: service.id,
      mirrorOf: boundaryBlockId,
    };
    generatedEntries.push(sectionBlock);

    const sectionEntries: OntimeRundownEntry[] = [];
    for (const masterEntry of masterEntries) {
      const clone = structuredClone(masterEntry) as OntimeRundownEntry;
      clone.id = getUniqueId();
      clone.generatedFor = service.id;
      clone.mirrorOf = masterEntry.id;
      idMap.set(masterEntry.id, clone.id);

      if (isOntimeEvent(clone)) {
        clone.timeStart = (clone.timeStart + service.offset) % dayInMs;
        clone.timeEnd = (clone.timeEnd + service.offset) % dayInMs;
      }
      sectionEntries.push(clone);
    }

    // re-point links to the cloned counterparts
    // links that point outside the section (eg into the master) are removed
    // so that the section is not dragged back to the master's end
    for (const entry of sectionEntries) {
      if (isOntimeEvent(entry) && entry.linkStart !== null) {
        entry.linkStart = idMap.get(entry.linkStart) ?? null;
      }
    }

    generatedEntries.push(...sectionEntries);
  }

  return [...strippedRundown, ...generatedEntries];
}

/**
 * A rundown source is a rundown which lives outside the project file
 * and can be recalled into it on demand, eg. a worksheet tab in a Google Sheet.
 *
 * Providers are the adapters which know how to list and fetch those rundowns.
 * Adding a new origin means adding a provider here, the recall API stays the same.
 */

import type { CustomFields, MaybeString, OntimeRundown, RundownSourceProvider, ServiceProfiles } from 'ontime-types';

import { fetchPcoSource, getResolvedServiceTypeId, isPcoEnabled, listPcoSources } from '../pco-service/PcoService.js';
import { download, getImportMap, getLinkedSheetId, hasAuth, listWorksheets } from '../sheet-service/SheetService.js';

export type FetchedSource = {
  rundown: OntimeRundown;
  /** providers which do not carry custom fields can omit these, the current ones are kept */
  customFields?: CustomFields | null;
  serviceProfiles?: ServiceProfiles | null;
};

export type RundownSourceProviderApi = {
  id: RundownSourceProvider;
  /** whether the provider is currently able to serve sources */
  isAvailable: () => boolean;
  /** identifier of the container the sources live in, shown to consumers for context */
  getContainerId: () => MaybeString;
  /** ordered list of source names, the order defines the recall index */
  list: () => Promise<string[]>;
  /** reads a single source by name */
  fetch: (name: string) => Promise<FetchedSource>;
};

const gsheetProvider: RundownSourceProviderApi = {
  id: 'gsheet',
  isAvailable: () => hasAuth().authenticated === 'authenticated' && Boolean(getLinkedSheetId()),
  getContainerId: () => getLinkedSheetId(),
  list: () => listWorksheets(),
  fetch: (name: string) => {
    const sheetId = getLinkedSheetId();
    if (!sheetId) {
      throw new Error('No Google Sheet is linked');
    }
    // we reuse the import map from the last import so the column mapping matches the UI
    return download(sheetId, { ...getImportMap(), worksheet: name });
  },
};

/**
 * Planning Center, one source per pinned service type.
 *
 * The name is the service type, not a plan date, and the plan is chosen at recall
 * time: "Central AM" keeps meaning the next Central AM service, so a button built
 * on it survives the week.
 */
const pcoProvider: RundownSourceProviderApi = {
  id: 'pco',
  isAvailable: () => isPcoEnabled(),
  getContainerId: () => getResolvedServiceTypeId(),
  list: () => listPcoSources(),
  fetch: (name: string) => fetchPcoSource(name),
};

/**
 * Order defines the order sources are listed in, and the sheet comes first so that
 * an existing worksheet index keeps pointing at the same tab now that Planning
 * Center contributes to the same list.
 */
const providers: RundownSourceProviderApi[] = [gsheetProvider, pcoProvider];

/**
 * Every provider that can currently serve sources.
 *
 * They coexist: a linked sheet and Planning Center are both listed, and a recall
 * says which one it means. This used to return a single winner, which meant turning
 * Planning Center on silently stopped worksheet recall.
 */
export function getAvailableProviders(): RundownSourceProviderApi[] {
  return providers.filter((provider) => provider.isAvailable());
}

/** one provider by id, for a scoped recall */
export function getProvider(id: RundownSourceProvider): RundownSourceProviderApi | undefined {
  return providers.find((provider) => provider.id === id);
}

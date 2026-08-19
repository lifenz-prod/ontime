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
 * Planning Center plans, one source per upcoming plan, soonest first.
 *
 * Ahead of the sheet in the list because it only becomes available once
 * `enabled` is set in pco-rules.json, which is an explicit choice to recall plans
 * instead of worksheet tabs. Credentials alone do not switch anything over.
 */
const pcoProvider: RundownSourceProviderApi = {
  id: 'pco',
  isAvailable: () => isPcoEnabled(),
  getContainerId: () => getResolvedServiceTypeId(),
  list: () => listPcoSources(),
  fetch: (name: string) => fetchPcoSource(name),
};

const providers: RundownSourceProviderApi[] = [pcoProvider, gsheetProvider];

/**
 * Returns the provider which can currently serve sources
 */
export function getActiveProvider(): RundownSourceProviderApi | null {
  return providers.find((provider) => provider.isAvailable()) ?? null;
}

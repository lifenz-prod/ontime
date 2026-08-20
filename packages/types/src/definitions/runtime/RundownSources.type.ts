import type { MaybeString } from '../../utils/utils.type.js';

/**
 * Identifies where a recallable rundown comes from.
 * `gsheet` reads the worksheet tabs of the linked Google Sheet,
 * `pco` reads the pinned service types of the Planning Center organisation.
 */
export type RundownSourceProvider = 'gsheet' | 'pco';

/**
 * A rundown which can be recalled by index or by name.
 *
 * Providers coexist: a linked sheet and Planning Center both contribute, and every
 * source says which one it came from so a recall can be aimed at one of them.
 */
export type RundownSource = {
  /** 1 based position in the whole list, the address used for an unscoped recall */
  index: number;
  name: string;
  provider: RundownSourceProvider;
  /**
   * 1 based position within this provider's own sources.
   *
   * This is the stable address: adding a worksheet tab shifts every `index` after
   * it, but not the positions inside Planning Center. A button aimed at one
   * provider should use this.
   */
  providerIndex: number;
};

/** one connected origin, and how listing it went */
export type RundownSourceOrigin = {
  id: RundownSourceProvider;
  /** identifier of the container the sources live in, eg. the google sheet ID */
  containerId: MaybeString;
  /** how many sources this provider contributed */
  count: number;
  /** why this provider could not be listed, null when it was fine */
  error: MaybeString;
};

export type RundownSourcesState = {
  /** every source from every connected provider */
  sources: RundownSource[];
  /** the connected providers, in the order they contribute to `sources` */
  providers: RundownSourceOrigin[];
  /** name of the source last loaded into the rundown */
  loaded: MaybeString;
  /** which provider that source came from */
  loadedProvider: RundownSourceProvider | null;
  /** whether a refresh or a load is in flight */
  loading: boolean;
  /** reason for the last failed operation, cleared on success */
  error: MaybeString;
  /** increments on every successful list refresh, lets consumers detect change */
  revision: number;
};

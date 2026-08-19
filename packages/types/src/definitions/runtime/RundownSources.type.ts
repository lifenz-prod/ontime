import type { MaybeString } from '../../utils/utils.type.js';

/**
 * Identifies where a recallable rundown comes from.
 * `gsheet` reads the worksheet tabs of the linked Google Sheet,
 * `pco` reads the upcoming plans of a Planning Center service type.
 */
export type RundownSourceProvider = 'gsheet' | 'pco';

/**
 * A rundown which can be recalled by index or by name,
 * eg. a worksheet tab in the linked Google Sheet
 */
export type RundownSource = {
  /** 1 based position in the list, this is the address used for recall */
  index: number;
  name: string;
};

export type RundownSourcesState = {
  /** which provider populated the list */
  provider: RundownSourceProvider | null;
  /** identifier of the container holding the sources, eg. the google sheet ID */
  containerId: MaybeString;
  sources: RundownSource[];
  /** name of the source last loaded into the rundown */
  loaded: MaybeString;
  /** whether a refresh or a load is in flight */
  loading: boolean;
  /** reason for the last failed operation, cleared on success */
  error: MaybeString;
  /** increments on every successful list refresh, lets consumers detect change */
  revision: number;
};

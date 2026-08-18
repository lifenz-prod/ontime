/**
 * Exposes the rundowns which can be recalled into the project
 * and performs the recall itself.
 *
 * The list is published to the runtime store as `rundownSources` so that
 * integrations (eg. Companion over websocket) can populate a selector,
 * and recall is triggered through the integration API with `loadsource`.
 */

import { LogOrigin, type RundownSource, type RundownSourcesState } from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';
import { patchCurrentProject } from '../project-service/ProjectService.js';
import { getCustomFields } from '../rundown-service/rundownCache.js';
import { runtimeService } from '../runtime-service/RuntimeService.js';
import { getState } from '../../stores/runtimeState.js';

import { getActiveProvider, type RundownSourceProviderApi } from './rundownSourceProviders.js';
import { playbackBlocksRecall, resolveSourceTarget } from './rundownSourceUtils.js';

let state: RundownSourcesState = {
  provider: null,
  containerId: null,
  sources: [],
  loaded: null,
  loading: false,
  error: null,
  revision: 0,
};

/**
 * Guards against overlapping refresh / load operations.
 * Javascript is single threaded, so claiming it without an await in between is atomic.
 */
let isBusy = false;

const noProviderMessage = 'No rundown source is connected';

function claim() {
  if (isBusy) {
    throw new Error('Rundown sources are busy, try again shortly');
  }
  isBusy = true;
}

function publish(patch: Partial<RundownSourcesState>) {
  state = { ...state, ...patch };
  eventStore.set('rundownSources', state);
}

export function getRundownSourcesState(): RundownSourcesState {
  return state;
}

/**
 * Reads the list from the provider and publishes it
 * The caller is responsible for the busy guard
 */
async function listFrom(provider: RundownSourceProviderApi): Promise<void> {
  const names = await provider.list();
  const sources: RundownSource[] = names.map((name, index) => ({ index: index + 1, name }));

  publish({
    provider: provider.id,
    containerId: provider.getContainerId(),
    sources,
    loading: false,
    error: null,
    revision: state.revision + 1,
  });
}

/**
 * Reads the list of available rundowns from the active provider
 */
export async function refreshRundownSources(): Promise<RundownSourcesState> {
  const provider = getActiveProvider();

  if (!provider) {
    publish({ provider: null, containerId: null, sources: [], loading: false, error: noProviderMessage });
    throw new Error(noProviderMessage);
  }

  claim();
  publish({ loading: true, error: null });

  try {
    await listFrom(provider);
    return state;
  } catch (error) {
    const message = getErrorMessage(error);
    publish({ loading: false, error: message });
    throw new Error(`Unable to list rundown sources: ${message}`);
  } finally {
    isBusy = false;
  }
}

/**
 * A recall replaces the rundown and stops the timer, we refuse to do that to a live show.
 * Exposed so that callers can refuse synchronously and report a real error,
 * the recall itself checks again so every path is covered.
 * @throws when playback would be interrupted
 */
export function assertRecallAllowed() {
  const { playback } = getState().timer;
  if (playbackBlocksRecall(playback)) {
    const message = `Refusing to recall a rundown while playback is ${playback}, stop playback first`;
    publish({ error: message });
    throw new Error(message);
  }
}

/**
 * Recalls a rundown into the current project and arms its first event
 * @param target 1 based index or name of the source
 */
export async function loadRundownSource(target: number | string): Promise<RundownSource> {
  assertRecallAllowed();

  const provider = getActiveProvider();

  if (!provider) {
    publish({ provider: null, containerId: null, sources: [], loading: false, error: noProviderMessage });
    throw new Error(noProviderMessage);
  }

  // claimed for the whole operation, including the refresh below
  claim();
  publish({ loading: true, error: null });

  try {
    // the list may be stale or empty on a cold start, refresh before giving up on a target
    if (!resolveSourceTarget(state.sources, target)) {
      await listFrom(provider);
      publish({ loading: true });
    }

    const source = resolveSourceTarget(state.sources, target);
    if (!source) {
      throw new Error(`Rundown source not found: ${target} (${state.sources.length} available)`);
    }

    logger.info(LogOrigin.Server, `Recalling rundown "${source.name}"`);

    const { rundown, customFields, serviceProfiles } = await provider.fetch(source.name);
    if (rundown.length < 1) {
      throw new Error(`Rundown source "${source.name}" contains no events`);
    }

    // patching without custom fields would clear the existing ones, so we carry them over
    const nextCustomFields = customFields ?? getCustomFields();

    // this replaces the rundown and stops playback, mirroring an import from the UI
    await patchCurrentProject({
      rundown,
      customFields: nextCustomFields,
      ...(serviceProfiles ? { serviceProfiles } : {}),
    });

    // arm the first event so the operator only needs to press go
    const didLoad = runtimeService.loadByIndex(0);
    if (!didLoad) {
      logger.warning(LogOrigin.Server, `Recalled "${source.name}" but found no event to load`);
    }

    publish({ loaded: source.name, loading: false, error: null });
    logger.info(LogOrigin.Server, `Recalled rundown "${source.name}" with ${rundown.length} entries`);

    return source;
  } catch (error) {
    const message = getErrorMessage(error);
    publish({ loading: false, error: message });
    throw new Error(message);
  } finally {
    isBusy = false;
  }
}

/**
 * Populates the source list at startup without blocking the boot sequence
 */
export function init() {
  refreshRundownSources().catch((error) => {
    logger.warning(LogOrigin.Server, `Could not list rundown sources: ${getErrorMessage(error)}`);
  });
}

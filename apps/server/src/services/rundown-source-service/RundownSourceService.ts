/**
 * Exposes the rundowns which can be recalled into the project
 * and performs the recall itself.
 *
 * The list is published to the runtime store as `rundownSources` so that
 * integrations (eg. Companion over websocket) can populate a selector,
 * and recall is triggered through the integration API with `loadsource`.
 *
 * Providers coexist. A linked Google Sheet contributes its worksheet tabs and
 * Planning Center contributes its pinned service types, both in one list, each
 * source saying where it came from. A recall can name a provider to be
 * unambiguous, and should when a button is meant to hit one of them.
 */

import {
  LogOrigin,
  type RundownSource,
  type RundownSourceOrigin,
  type RundownSourcesState,
} from 'ontime-types';
import { getErrorMessage } from 'ontime-utils';

import { logger } from '../../classes/Logger.js';
import { eventStore } from '../../stores/EventStore.js';
import { patchCurrentProject } from '../project-service/ProjectService.js';
import { getCustomFields } from '../rundown-service/rundownCache.js';
import { getState } from '../../stores/runtimeState.js';

import { getAvailableProviders, getProvider, type RundownSourceProviderApi } from './rundownSourceProviders.js';
import { playbackBlocksRecall, resolveSourceTarget, type SourceTarget } from './rundownSourceUtils.js';

let state: RundownSourcesState = {
  sources: [],
  providers: [],
  loaded: null,
  loadedProvider: null,
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
 * Reads every available provider and publishes one merged list.
 *
 * A provider that fails is recorded against itself and skipped, so a revoked
 * Google token does not hide the Planning Center services, or the reverse. The
 * whole thing only fails when nothing could be listed at all.
 *
 * The caller is responsible for the busy guard.
 */
async function listFrom(providers: RundownSourceProviderApi[]): Promise<void> {
  const sources: RundownSource[] = [];
  const origins: RundownSourceOrigin[] = [];
  const failures: string[] = [];

  for (const provider of providers) {
    try {
      const names = await provider.list();
      names.forEach((name, position) => {
        sources.push({
          index: sources.length + 1,
          providerIndex: position + 1,
          name,
          provider: provider.id,
        });
      });
      origins.push({ id: provider.id, containerId: provider.getContainerId(), count: names.length, error: null });
    } catch (error) {
      const message = getErrorMessage(error);
      origins.push({ id: provider.id, containerId: provider.getContainerId(), count: 0, error: message });
      failures.push(`${provider.id}: ${message}`);
      logger.warning(LogOrigin.Server, `Could not list ${provider.id} rundown sources: ${message}`);
    }
  }

  if (sources.length === 0 && failures.length > 0) {
    throw new Error(failures.join('; '));
  }

  publish({
    sources,
    providers: origins,
    loading: false,
    error: null,
    revision: state.revision + 1,
  });
}

/**
 * Reads the list of available rundowns from every connected provider
 */
export async function refreshRundownSources(): Promise<RundownSourcesState> {
  const providers = getAvailableProviders();

  if (providers.length === 0) {
    publish({ sources: [], providers: [], loading: false, error: noProviderMessage });
    throw new Error(noProviderMessage);
  }

  claim();
  publish({ loading: true, error: null });

  try {
    await listFrom(providers);
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
 * Recalls a rundown into the current project, leaving playback untouched
 * @param address a position or name, optionally scoped to one provider
 */
export async function loadRundownSource(address: SourceTarget): Promise<RundownSource> {
  assertRecallAllowed();

  const providers = getAvailableProviders();

  if (providers.length === 0) {
    publish({ sources: [], providers: [], loading: false, error: noProviderMessage });
    throw new Error(noProviderMessage);
  }

  // claimed for the whole operation, including the refresh below
  claim();
  publish({ loading: true, error: null });

  try {
    // the list may be stale or empty on a cold start, refresh before giving up on a target
    if (!resolveSourceTarget(state.sources, address)) {
      await listFrom(providers);
      publish({ loading: true });
    }

    const source = resolveSourceTarget(state.sources, address);
    if (!source) {
      const scope = address.provider ? ` in ${address.provider}` : '';
      throw new Error(`Rundown source not found: ${address.target}${scope} (${state.sources.length} available)`);
    }

    const provider = getProvider(source.provider);
    if (!provider) {
      throw new Error(`No provider for ${source.provider}`);
    }

    logger.info(LogOrigin.Server, `Recalling ${source.provider} rundown "${source.name}"`);

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

    publish({ loaded: source.name, loadedProvider: source.provider, loading: false, error: null });
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

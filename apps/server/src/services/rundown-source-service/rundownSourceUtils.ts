import { Playback, type RundownSource, type RundownSourceProvider } from 'ontime-types';

/** a recall address: a position or a name, optionally aimed at one provider */
export type SourceTarget = {
  provider?: RundownSourceProvider;
  /** a 1 based position, or a name */
  target: number | string;
};

const providerIds: RundownSourceProvider[] = ['gsheet', 'pco'];

function asProvider(value: unknown): RundownSourceProvider | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const wanted = value.trim().toLowerCase();
  return providerIds.find((id) => id === wanted);
}

/**
 * Resolves the payload of a source recall.
 *
 * Accepts a bare index or name, an object with `index` or `name`, either of those
 * with a `provider`, or a prefixed string like `pco:Central AM` -- OSC and HTTP
 * often only have one string to carry, and a prefix is how they say which provider
 * they mean.
 * @throws if the payload cannot be read as either
 */
export function parseSourceTarget(payload: unknown): SourceTarget {
  let value = payload;
  let provider: RundownSourceProvider | undefined;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    provider = asProvider(record.provider);

    if ('index' in record) {
      value = record.index;
    } else if ('name' in record) {
      value = record.name;
    } else {
      /**
       * `{ pco: 1 }`, which is what a provider in the path becomes: both the OSC and
       * the HTTP adapters fold `/loadsource/pco 1` into an object keyed by the
       * segment. Handled here so `/ontime/loadsource/pco 1` needs no special case
       * in the adapters.
       */
      const keys = Object.keys(record);
      const keyed = keys.length === 1 ? asProvider(keys[0]) : undefined;

      if (!keyed) {
        throw new Error('Payload is not a valid source index or name');
      }
      provider = keyed;
      value = record[keys[0]];
    }
  }

  if (typeof value === 'number') {
    return { provider, target: assertSourceIndex(value) };
  }

  if (typeof value === 'string') {
    let target = value.trim();

    // "pco:Central AM" / "gsheet:2", but not a name that merely contains a colon
    const separator = target.indexOf(':');
    if (separator > 0) {
      const prefix = asProvider(target.slice(0, separator));
      if (prefix) {
        provider = prefix;
        target = target.slice(separator + 1).trim();
      }
    }

    if (target === '') {
      throw new Error('Payload is not a valid source index or name');
    }
    // OSC and HTTP often carry numbers as text, treat those as an index
    if (!isNaN(Number(target))) {
      return { provider, target: assertSourceIndex(Number(target)) };
    }
    return { provider, target };
  }

  throw new Error('Payload is not a valid source index or name');
}

function assertSourceIndex(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Source index out of range ${value}`);
  }
  return value;
}

/**
 * Finds the source an address points at.
 *
 * Scoped to a provider, an index counts within that provider, because that is the
 * position which does not move when another provider gains a source. Unscoped, it
 * is the position in the whole list. Names are matched case insensitively.
 *
 * @throws when an unscoped name exists in more than one provider, rather than
 * picking one and replacing the rundown from the wrong place
 */
export function resolveSourceTarget(sources: RundownSource[], address: SourceTarget): RundownSource | undefined {
  const { provider, target } = address;
  const pool = provider ? sources.filter((source) => source.provider === provider) : sources;

  if (typeof target === 'number') {
    return provider
      ? pool.find((source) => source.providerIndex === target)
      : pool.find((source) => source.index === target);
  }

  const normalised = target.trim().toLowerCase();
  const matches = pool.filter((source) => source.name.toLowerCase() === normalised);

  if (matches.length > 1) {
    const where = matches.map((source) => source.provider).join(' and ');
    throw new Error(`"${target}" exists in ${where}, say which one: eg. ${matches[0].provider}:${matches[0].name}`);
  }

  return matches[0];
}

/**
 * Whether the current playback state means a recall would interrupt a live show.
 *
 * `armed` is deliberately allowed: nothing is running yet, so replacing the rundown
 * interrupts no one. A recall does not arm anything itself.
 */
export function playbackBlocksRecall(playback: Playback): boolean {
  return playback === Playback.Play || playback === Playback.Pause || playback === Playback.Roll;
}

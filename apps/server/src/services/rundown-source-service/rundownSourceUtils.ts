import { Playback, type RundownSource } from 'ontime-types';

/**
 * Resolves the payload of a source recall to an index or a name
 * accepts a bare value, or an object with an `index` or `name` key
 * @throws if the payload cannot be read as either
 */
export function parseSourceTarget(payload: unknown): number | string {
  let value = payload;

  if (value && typeof value === 'object') {
    if ('index' in value) {
      value = value.index;
    } else if ('name' in value) {
      value = value.name;
    } else {
      throw new Error('Payload is not a valid source index or name');
    }
  }

  if (typeof value === 'number') {
    return assertSourceIndex(value);
  }

  if (typeof value === 'string') {
    const target = value.trim();
    if (target === '') {
      throw new Error('Payload is not a valid source index or name');
    }
    // OSC and HTTP often carry numbers as text, treat those as an index
    if (!isNaN(Number(target))) {
      return assertSourceIndex(Number(target));
    }
    return target;
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
 * Finds a source by its 1 based index or by name, names are matched case insensitively
 */
export function resolveSourceTarget(sources: RundownSource[], target: number | string): RundownSource | undefined {
  if (typeof target === 'number') {
    return sources.find((source) => source.index === target);
  }

  const normalised = target.trim().toLowerCase();
  return sources.find((source) => source.name.toLowerCase() === normalised);
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

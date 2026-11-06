import { AbletonSettings, AbletonTimer, DatabaseModel } from 'ontime-types';
import { generateId } from 'ontime-utils';

import { dbModel } from '../../models/dataModel.js';

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Reads the timer list, keeping only entries that point at a track and clip and have a target.
 * A timer missing its id gets one, so the settings table can key its rows.
 */
export function parseAbletonTimers(timers: unknown): AbletonTimer[] {
  if (!Array.isArray(timers)) {
    return [];
  }

  return timers.flatMap((timer) => {
    if (!timer || typeof timer !== 'object') return [];
    const { id, name, track, clip, target } = timer as Partial<Record<keyof AbletonTimer, unknown>>;
    if (!isPositiveInteger(track) || !isPositiveInteger(clip)) return [];
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return [];

    return [
      {
        id: typeof id === 'string' && id !== '' ? id : generateId(),
        name: typeof name === 'string' ? name.trim() : '',
        track,
        clip,
        target: Math.round(target),
      },
    ];
  });
}

export function parseAbletonSettings(data: Partial<DatabaseModel>): AbletonSettings {
  const defaults = dbModel.ableton;
  const source = data.ableton as Partial<AbletonSettings> | undefined;
  if (!source || typeof source !== 'object') {
    return { ...defaults, timers: [] };
  }

  const number = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    host: typeof source.host === 'string' && source.host !== '' ? source.host : defaults.host,
    port: number(source.port, defaults.port),
    listenPort: number(source.listenPort, defaults.listenPort),
    warningThreshold: number(source.warningThreshold, defaults.warningThreshold),
    dangerThreshold: number(source.dangerThreshold, defaults.dangerThreshold),
    timeout: number(source.timeout, defaults.timeout),
    timers: parseAbletonTimers(source.timers),
  };
}

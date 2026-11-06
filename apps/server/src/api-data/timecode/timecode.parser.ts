import { DatabaseModel, TimecodeSettings, TimecodeTimer } from 'ontime-types';
import { generateId } from 'ontime-utils';

import { dbModel } from '../../models/dataModel.js';

/** a day of timecode, in milliseconds */
const dayMs = 24 * 60 * 60 * 1000;

function isTimecodeMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < dayMs;
}

/**
 * Reads the timer list, keeping only timers with a range that runs forward.
 * A timer missing its id gets one, so the settings table can key its rows.
 */
export function parseTimecodeTimers(timers: unknown): TimecodeTimer[] {
  if (!Array.isArray(timers)) {
    return [];
  }

  return timers.flatMap((timer) => {
    if (!timer || typeof timer !== 'object') return [];
    const { id, name, from, zero } = timer as Partial<Record<keyof TimecodeTimer, unknown>>;
    if (!isTimecodeMs(from) || !isTimecodeMs(zero) || zero <= from) return [];

    return [
      {
        id: typeof id === 'string' && id !== '' ? id : generateId(),
        name: typeof name === 'string' ? name.trim() : '',
        from: Math.round(from),
        zero: Math.round(zero),
      },
    ];
  });
}

export function parseTimecodeSettings(data: Partial<DatabaseModel>): TimecodeSettings {
  const defaults = dbModel.timecode;
  const source = data.timecode as Partial<TimecodeSettings> | undefined;
  if (!source || typeof source !== 'object') {
    return { ...defaults, timers: [] };
  }

  const number = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
    deviceLabel: typeof source.deviceLabel === 'string' ? source.deviceLabel : defaults.deviceLabel,
    channel:
      typeof source.channel === 'number' && Number.isInteger(source.channel) && source.channel >= 1
        ? source.channel
        : defaults.channel,
    warningThreshold: number(source.warningThreshold, defaults.warningThreshold),
    dangerThreshold: number(source.dangerThreshold, defaults.dangerThreshold),
    timeout: number(source.timeout, defaults.timeout),
    timers: parseTimecodeTimers(source.timers),
  };
}

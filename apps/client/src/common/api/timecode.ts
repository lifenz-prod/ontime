import axios from 'axios';
import type { TimecodeSettings, TimecodeSetup, TimecodeTimer } from 'ontime-types';

import { apiEntryUrl } from './constants';

const timecodePath = `${apiEntryUrl}/timecode`;

export async function getTimecodeSettings(): Promise<TimecodeSettings> {
  const res = await axios.get(timecodePath);
  return res.data;
}

export async function editTimecodeSettings(settings: TimecodeSettings): Promise<TimecodeSettings> {
  const res = await axios.post(timecodePath, settings);
  return res.data;
}

/** The timecode right now, to the frame, for "Set to current timecode" */
export async function getCurrentTimecode(): Promise<{ current: number | null; fps: number | null; signal: boolean }> {
  const res = await axios.get(`${timecodePath}/current`);
  return res.data;
}

/** The saved timer setups, shared by every project */
export async function getTimecodeSetups(): Promise<TimecodeSetup[]> {
  const res = await axios.get(`${timecodePath}/setups`);
  return res.data;
}

/** Saves timers under a name, replacing a setup of the same name. Returns the updated list */
export async function saveTimecodeSetup(name: string, timers: TimecodeTimer[]): Promise<TimecodeSetup[]> {
  const res = await axios.post(`${timecodePath}/setups`, { name, timers });
  return res.data;
}

export async function deleteTimecodeSetup(id: string): Promise<TimecodeSetup[]> {
  const res = await axios.delete(`${timecodePath}/setups/${encodeURIComponent(id)}`);
  return res.data;
}

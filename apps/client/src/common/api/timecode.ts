import axios from 'axios';
import type { TimecodeSettings } from 'ontime-types';

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

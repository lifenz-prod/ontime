import axios from 'axios';
import type { AbletonClipPosition, AbletonSettings } from 'ontime-types';

import { apiEntryUrl } from './constants';

const abletonPath = `${apiEntryUrl}/ableton`;

export async function getAbletonSettings(): Promise<AbletonSettings> {
  const res = await axios.get(abletonPath);
  return res.data;
}

export async function editAbletonSettings(settings: AbletonSettings): Promise<AbletonSettings> {
  const res = await axios.post(abletonPath, settings);
  return res.data;
}

/** Reads where Live's playhead is in a clip, for "Set to current position" */
export async function readAbletonClipPosition(track: number, clip: number): Promise<AbletonClipPosition> {
  const res = await axios.post(`${abletonPath}/position`, { track, clip });
  return res.data;
}

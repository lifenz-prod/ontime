import axios from 'axios';
import type { MittiSettings } from 'ontime-types';

import { apiEntryUrl } from './constants';

const mittiPath = `${apiEntryUrl}/mitti`;

export async function getMittiSettings(): Promise<MittiSettings> {
  const res = await axios.get(mittiPath);
  return res.data;
}

export async function editMittiSettings(settings: MittiSettings): Promise<MittiSettings> {
  const res = await axios.post(mittiPath, settings);
  return res.data;
}

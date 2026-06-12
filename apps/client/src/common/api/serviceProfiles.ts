import axios from 'axios';
import type { ServiceProfiles } from 'ontime-types';

import { apiEntryUrl } from './constants';

const serviceProfilesPath = `${apiEntryUrl}/service-profiles`;

export async function getServiceProfiles(): Promise<ServiceProfiles> {
  const res = await axios.get(serviceProfilesPath);
  return res.data;
}

export async function editServiceProfiles(profiles: ServiceProfiles): Promise<ServiceProfiles> {
  const res = await axios.post(serviceProfilesPath, profiles);
  return res.data;
}

export async function regenerateServiceInstances(): Promise<void> {
  await axios.post(`${serviceProfilesPath}/regenerate`);
}

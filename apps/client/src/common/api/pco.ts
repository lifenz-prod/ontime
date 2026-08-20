import axios from 'axios';
import type {
  PcoCredentialsRequest,
  PcoImportRequest,
  PcoImportResult,
  PcoKnownItems,
  PcoPlanSummary,
  PcoRules,
  PcoServiceTypeSummary,
  PcoStatus,
} from 'ontime-types';

import { apiEntryUrl } from './constants';

const pcoPath = `${apiEntryUrl}/pco`;

export async function getPcoStatus(): Promise<PcoStatus> {
  const res = await axios.get(pcoPath);
  return res.data;
}

export async function getPcoServiceTypes(): Promise<PcoServiceTypeSummary[]> {
  const res = await axios.get(`${pcoPath}/service-types`);
  return res.data;
}

/** upcoming plans for the given service types, or for the pinned ones when none are given */
export async function getPcoPlans(serviceTypeIds: string[]): Promise<PcoPlanSummary[]> {
  const res = await axios.get(`${pcoPath}/plans`, {
    params: serviceTypeIds.length > 0 ? { serviceTypeIds: serviceTypeIds.join(',') } : undefined,
  });
  return res.data;
}

export async function getPcoKnownItems(serviceTypeId?: string): Promise<PcoKnownItems> {
  const res = await axios.get(`${pcoPath}/known-items`, {
    params: serviceTypeId ? { serviceTypeId } : undefined,
  });
  return res.data;
}

export async function getPcoRules(): Promise<PcoRules> {
  const res = await axios.get(`${pcoPath}/rules`);
  return res.data;
}

export async function editPcoRules(rules: PcoRules): Promise<PcoRules> {
  const res = await axios.post(`${pcoPath}/rules`, rules);
  return res.data;
}

/** replaces the project rundown with the plan; refused while a show is running */
export async function importPcoPlan(request: PcoImportRequest): Promise<PcoImportResult> {
  const res = await axios.post(`${pcoPath}/import`, request);
  return res.data;
}

/**
 * Saves a token pair. The response is the new status: a secret only travels
 * inwards, and nothing that could be used to authenticate comes back.
 */
export async function setPcoCredentials(credentials: PcoCredentialsRequest): Promise<PcoStatus> {
  const res = await axios.post(`${pcoPath}/credentials`, credentials);
  return res.data;
}

export async function deletePcoCredentials(): Promise<PcoStatus> {
  const res = await axios.delete(`${pcoPath}/credentials`);
  return res.data;
}

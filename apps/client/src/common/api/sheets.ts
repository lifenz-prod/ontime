import axios, { AxiosResponse } from 'axios';
import {
  AuthenticationStatus,
  CustomFields,
  OntimeRundown,
  PublicSheetInfo,
  RecentSheet,
  ServiceProfiles,
} from 'ontime-types';
import { ImportMap } from 'ontime-utils';

import { apiEntryUrl } from './constants';

const sheetsPath = `${apiEntryUrl}/sheets`;

/**
 * HTTP request to verify whether we are authenticated with Google Sheet service
 */
export const verifyAuthenticationStatus = async (): Promise<{
  authenticated: AuthenticationStatus;
  sheetId: string;
}> => {
  const response = await axios.get(`${sheetsPath}/connect`);
  return response.data;
};

/**
 * HTTP request to initiate the authentication service with google
 */
export const requestConnection = async (
  file: File,
  sheetId: string,
): Promise<{
  verification_url: string;
  user_code: string;
}> => {
  const formData = new FormData();
  formData.append('client_secret', file);

  const response = await axios.post(`${sheetsPath}/${sheetId}/connect`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

/**
 * HTTP request to revoke authentication to google sheet
 */
export const revokeAuthentication = async (): Promise<{ authenticated: AuthenticationStatus }> => {
  const response = await axios.post(`${sheetsPath}/revoke`);
  return response.data;
};

/**
 * HTTP request to upload preview the contents of a google sheet as rundown
 */
export const previewRundown = async (
  sheetId: string,
  options: ImportMap,
): Promise<{
  rundown: OntimeRundown;
  customFields: CustomFields;
  serviceProfiles: ServiceProfiles;
}> => {
  const response = await axios.post(`${sheetsPath}/${sheetId}/read`, { options });
  return response.data;
};

export const getWorksheetNames = async (sheetId: string): Promise<string[]> => {
  const response: AxiosResponse<string[]> = await axios.post(`${sheetsPath}/${sheetId}/worksheets`);
  return response.data;
};

/**
 * HTTP request to upload the rundown to a google sheet
 */
export const uploadRundown = async (sheetId: string, options: ImportMap): Promise<void> => {
  const response = await axios.post(`${sheetsPath}/${sheetId}/write`, { options });
  return response.data;
};

/**
 * HTTP request to open a sheet shared as "anyone with the link can view", no authentication needed
 * @param url - a link to the sheet or its ID
 */
export const openPublicSheet = async (url: string): Promise<PublicSheetInfo> => {
  const response: AxiosResponse<PublicSheetInfo> = await axios.post(`${sheetsPath}/public/open`, { url });
  return response.data;
};

/**
 * HTTP request to preview the contents of a public google sheet as rundown
 */
export const previewPublicRundown = async (
  sheetId: string,
  options: ImportMap,
): Promise<{
  rundown: OntimeRundown;
  customFields: CustomFields;
  serviceProfiles: ServiceProfiles;
}> => {
  const response = await axios.post(`${sheetsPath}/public/${sheetId}/read`, { options });
  return response.data;
};

/**
 * HTTP request to list the sheets recently imported from, most recent first
 */
export const getRecentSheets = async (): Promise<RecentSheet[]> => {
  const response: AxiosResponse<RecentSheet[]> = await axios.get(`${sheetsPath}/recent`);
  return response.data;
};

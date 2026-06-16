import { useQueryClient } from '@tanstack/react-query';
import { AuthenticationStatus, CustomFields, OntimeRundown, ServiceProfiles } from 'ontime-types';
import { ImportMap } from 'ontime-utils';

import { CUSTOM_FIELDS, RUNDOWN } from '../../../../common/api/constants';
import { patchData } from '../../../../common/api/db';
import {
  previewRundown,
  requestConnection,
  revokeAuthentication,
  uploadRundown,
  verifyAuthenticationStatus,
} from '../../../../common/api/sheets';
import { maybeAxiosError } from '../../../../common/api/utils';

import { useSheetStore } from './useSheetStore';

export default function useGoogleSheet() {
  const queryClient = useQueryClient();
  // functions push data to store
  const patchStepData = useSheetStore((state) => state.patchStepData);

  /** whether the current session has been authenticated */
  const verifyAuth = async (): Promise<{ authenticated: AuthenticationStatus; sheetId: string } | void> => {
    try {
      return await verifyAuthenticationStatus();
    } catch (error) {
      patchStepData({ authenticate: { available: false, error: maybeAxiosError(error) } });
    }
  };

  /** requests connection to a google sheet */
  const connect = async (
    file: File,
    sheetId: string,
  ): Promise<{ verification_url: string; user_code: string } | void> => {
    try {
      return await requestConnection(file, sheetId);
    } catch (error) {
      patchStepData({ authenticate: { available: false, error: maybeAxiosError(error) } });
    }
  };

  /** requests the revoking of an existing authenticated session */
  const revoke = async (): Promise<{ authenticated: AuthenticationStatus } | void> => {
    try {
      return await revokeAuthentication();
    } catch (error) {
      patchStepData({ authenticate: { available: false, error: maybeAxiosError(error) } });
    }
  };

  /** fetches data from a worksheet by its ID */
  const importRundownPreview = async (sheetId: string, fileOptions: ImportMap) => {
    try {
      return await previewRundown(sheetId, fileOptions);
    } catch (error) {
      patchStepData({ pullPush: { available: true, error: maybeAxiosError(error) } });
      return undefined;
    }
  };

  /** writes data to a worksheet by its ID */
  const exportRundown = async (sheetId: string, fileOptions: ImportMap) => {
    try {
      // write data to google
      await uploadRundown(sheetId, fileOptions);
      patchStepData({ pullPush: { available: false, error: '' } });
    } catch (error) {
      patchStepData({ pullPush: { available: true, error: maybeAxiosError(error) } });
    }
  };

  /** applies rundown and customFields to current project */
  const importRundown = async (
    rundown: OntimeRundown,
    customFields: CustomFields,
    serviceProfiles?: ServiceProfiles | null,
  ) => {
    try {
      await patchData({ rundown, customFields, ...(serviceProfiles ? { serviceProfiles } : {}) });
      // we are unable to optimistically set the rundown since we need
      // it to be normalised
      await queryClient.invalidateQueries({
        queryKey: [RUNDOWN, CUSTOM_FIELDS],
      });
    } catch (error) {
      patchStepData({ pullPush: { available: true, error: maybeAxiosError(error) } });
    }
  };

  return {
    connect,
    revoke,
    verifyAuth,

    importRundownPreview,
    importRundown,
    exportRundown,
  };
}

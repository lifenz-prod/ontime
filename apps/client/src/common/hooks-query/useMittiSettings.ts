import { useMutation, useQuery } from '@tanstack/react-query';
import type { MittiSettings } from 'ontime-types';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { MITTI } from '../api/constants';
import { editMittiSettings, getMittiSettings } from '../api/mitti';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

const mittiPlaceholderSettings: MittiSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 51000,
  listenPort: 51001,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 5000,
  relayHost: null,
  relayPort: null,
};

export default function useMittiSettings() {
  const { data, status, isFetching, isError, refetch } = useQuery({
    queryKey: MITTI,
    queryFn: getMittiSettings,
    placeholderData: (previousData, _previousQuery) => previousData,
    retry: 5,
    retryDelay: (attempt: number) => attempt * 2500,
    refetchInterval: queryRefetchIntervalSlow,
    networkMode: 'always',
  });

  return { data: data ?? mittiPlaceholderSettings, status, isFetching, isError, refetch };
}

export function useMittiSettingsMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editMittiSettings,
    onError: (error) => logAxiosError('Error saving Mitti settings', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(MITTI, data);
    },
    onSettled: () => ontimeQueryClient.invalidateQueries({ queryKey: MITTI }),
  });
  return { isPending, mutateAsync };
}

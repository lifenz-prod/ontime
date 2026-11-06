import { useMutation, useQuery } from '@tanstack/react-query';
import type { AbletonSettings } from 'ontime-types';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { editAbletonSettings, getAbletonSettings } from '../api/ableton';
import { ABLETON } from '../api/constants';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

const abletonPlaceholderSettings: AbletonSettings = {
  enabled: false,
  host: '127.0.0.1',
  port: 11000,
  listenPort: 11001,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 5000,
  timers: [],
};

export default function useAbletonSettings() {
  const { data, status, isFetching, isError, refetch } = useQuery({
    queryKey: ABLETON,
    queryFn: getAbletonSettings,
    placeholderData: (previousData, _previousQuery) => previousData,
    retry: 5,
    retryDelay: (attempt: number) => attempt * 2500,
    refetchInterval: queryRefetchIntervalSlow,
    networkMode: 'always',
  });

  return { data: data ?? abletonPlaceholderSettings, status, isFetching, isError, refetch };
}

export function useAbletonSettingsMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editAbletonSettings,
    onError: (error) => logAxiosError('Error saving Ableton settings', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(ABLETON, data);
    },
    onSettled: () => ontimeQueryClient.invalidateQueries({ queryKey: ABLETON }),
  });
  return { isPending, mutateAsync };
}

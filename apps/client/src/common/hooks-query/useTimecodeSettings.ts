import { useMutation, useQuery } from '@tanstack/react-query';
import type { TimecodeSettings } from 'ontime-types';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { TIMECODE } from '../api/constants';
import { editTimecodeSettings, getTimecodeSettings } from '../api/timecode';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

export const timecodePlaceholderSettings: TimecodeSettings = {
  enabled: false,
  deviceLabel: '',
  channel: 1,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 500,
  timers: [],
};

/**
 * @param refetchInterval the reader polls faster than the default, so a change of input made on
 * another machine reaches it within a couple of seconds
 */
export default function useTimecodeSettings(refetchInterval: number = queryRefetchIntervalSlow) {
  const { data, status, isFetching, isError, refetch } = useQuery({
    queryKey: TIMECODE,
    queryFn: getTimecodeSettings,
    placeholderData: (previousData, _previousQuery) => previousData,
    retry: 5,
    retryDelay: (attempt: number) => attempt * 2500,
    refetchInterval,
    networkMode: 'always',
  });

  return { data: data ?? timecodePlaceholderSettings, status, isFetching, isError, refetch };
}

export function useTimecodeSettingsMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editTimecodeSettings,
    onError: (error) => logAxiosError('Error saving timecode settings', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(TIMECODE, data);
    },
    onSettled: () => ontimeQueryClient.invalidateQueries({ queryKey: TIMECODE }),
  });
  return { isPending, mutateAsync };
}

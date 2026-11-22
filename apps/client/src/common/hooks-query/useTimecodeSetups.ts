import { useMutation, useQuery } from '@tanstack/react-query';
import type { TimecodeSetup, TimecodeTimer } from 'ontime-types';

import { TIMECODE_SETUPS } from '../api/constants';
import { deleteTimecodeSetup, getTimecodeSetups, saveTimecodeSetup } from '../api/timecode';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

const emptySetups: TimecodeSetup[] = [];

/** The saved timecode timer setups, shared by every project */
export default function useTimecodeSetups() {
  const { data, isError } = useQuery({
    queryKey: TIMECODE_SETUPS,
    queryFn: getTimecodeSetups,
    networkMode: 'always',
  });
  return { setups: data ?? emptySetups, isError };
}

export function useTimecodeSetupsMutation() {
  const onSuccess = (setups: TimecodeSetup[]) => ontimeQueryClient.setQueryData(TIMECODE_SETUPS, setups);

  const save = useMutation({
    mutationFn: ({ name, timers }: { name: string; timers: TimecodeTimer[] }) => saveTimecodeSetup(name, timers),
    onError: (error) => logAxiosError('Error saving timecode setup', error),
    onSuccess,
  });

  const remove = useMutation({
    mutationFn: deleteTimecodeSetup,
    onError: (error) => logAxiosError('Error deleting timecode setup', error),
    onSuccess,
  });

  return {
    saveSetup: save.mutateAsync,
    deleteSetup: remove.mutateAsync,
    isPending: save.isPending || remove.isPending,
  };
}

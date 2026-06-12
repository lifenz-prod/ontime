import { useMutation, useQuery } from '@tanstack/react-query';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { editServiceProfiles, getServiceProfiles } from '../api/serviceProfiles';
import { SERVICE_PROFILES } from '../api/constants';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

export default function useServiceProfiles() {
  const { data, status, isFetching, isError, refetch } = useQuery({
    queryKey: SERVICE_PROFILES,
    queryFn: getServiceProfiles,
    placeholderData: (previousData) => previousData,
    retry: 5,
    retryDelay: (attempt: number) => attempt * 2500,
    refetchInterval: queryRefetchIntervalSlow,
    networkMode: 'always',
  });

  return { data: data ?? [], status, isFetching, isError, refetch };
}

export function useServiceProfilesMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editServiceProfiles,
    onError: (error) => logAxiosError('Error saving service profiles', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(SERVICE_PROFILES, data);
    },
    onSettled: () => ontimeQueryClient.invalidateQueries({ queryKey: SERVICE_PROFILES }),
  });
  return { isPending, mutateAsync };
}

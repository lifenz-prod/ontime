import { useMutation, useQuery } from '@tanstack/react-query';
import type { ServiceProfiles } from 'ontime-types';

import { queryRefetchIntervalSlow } from '../../ontimeConfig';
import { RUNDOWN, SERVICE_PROFILES } from '../api/constants';
import { editServiceProfiles, getServiceProfiles, regenerateServiceInstances } from '../api/serviceProfiles';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

const emptyServiceProfiles: ServiceProfiles = { boundaryBlockId: null, services: [] };

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

  return { data: data ?? emptyServiceProfiles, status, isFetching, isError, refetch };
}

export function useServiceProfilesMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editServiceProfiles,
    onError: (error) => logAxiosError('Error saving service profiles', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(SERVICE_PROFILES, data);
    },
    onSettled: () => {
      ontimeQueryClient.invalidateQueries({ queryKey: SERVICE_PROFILES });
      // saving the config rebuilds the generated sections
      ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN });
    },
  });
  return { isPending, mutateAsync };
}

export function useRegenerateServiceInstances() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: regenerateServiceInstances,
    onError: (error) => logAxiosError('Error regenerating service instances', error),
    onSettled: () => ontimeQueryClient.invalidateQueries({ queryKey: RUNDOWN }),
  });
  return { isPending, regenerate: mutateAsync };
}

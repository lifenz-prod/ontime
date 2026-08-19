import { useMutation, useQuery } from '@tanstack/react-query';
import type { PcoKnownItems, PcoPlanSummary, PcoRules, PcoServiceTypeSummary, PcoStatus } from 'ontime-types';

import { PCO_KNOWN_ITEMS, PCO_PLANS, PCO_RULES, PCO_SERVICE_TYPES, PCO_STATUS } from '../api/constants';
import { editPcoRules, getPcoKnownItems, getPcoPlans, getPcoRules, getPcoServiceTypes, getPcoStatus } from '../api/pco';
import { logAxiosError } from '../api/utils';
import { ontimeQueryClient } from '../queryClient';

/**
 * Planning Center is a remote API behind a rate limit, and none of this data
 * changes while somebody is looking at the panel: a plan's run sheet is edited days
 * ahead, not mid-session. So these queries do not poll, and are refetched on demand.
 */
const remoteQueryOptions = {
  networkMode: 'always' as const,
  refetchOnWindowFocus: false,
  refetchInterval: false as const,
  retry: false,
  staleTime: 5 * 60 * 1000,
};

/**
 * No placeholder: an unanswered status is not the same as a bad one. Standing in
 * "no credentials" while the first request is in flight tells the operator
 * something false about their setup.
 */
export function usePcoStatus() {
  const { data, isFetching, isError, error, refetch } = useQuery<PcoStatus>({
    queryKey: PCO_STATUS,
    queryFn: getPcoStatus,
    ...remoteQueryOptions,
  });

  return { data, isFetching, isError, error, refetch };
}

/**
 * Every service type in the organisation.
 * Only fetched when asked for: it is the slowest call PCO serves, and it is only
 * needed while somebody is choosing what to pin.
 */
export function usePcoServiceTypes(enabled: boolean) {
  const { data, isFetching, isError, error, refetch } = useQuery<PcoServiceTypeSummary[]>({
    queryKey: PCO_SERVICE_TYPES,
    queryFn: getPcoServiceTypes,
    enabled,
    ...remoteQueryOptions,
    staleTime: 30 * 60 * 1000,
  });

  return { data: data ?? [], isFetching, isError, error, refetch };
}

export function usePcoPlans(serviceTypeIds: string[], enabled: boolean) {
  const { data, isFetching, isError, error, refetch } = useQuery<PcoPlanSummary[]>({
    // the ids are part of the key, so pinning a service type refetches
    queryKey: [...PCO_PLANS, serviceTypeIds],
    queryFn: () => getPcoPlans(serviceTypeIds),
    enabled,
    ...remoteQueryOptions,
  });

  return { data: data ?? [], isFetching, isError, error, refetch };
}

export function usePcoKnownItems(serviceTypeId: string | undefined, enabled: boolean) {
  const { data, isFetching, isError, error, refetch } = useQuery<PcoKnownItems>({
    queryKey: [...PCO_KNOWN_ITEMS, serviceTypeId],
    queryFn: () => getPcoKnownItems(serviceTypeId),
    enabled,
    ...remoteQueryOptions,
  });

  return { data, isFetching, isError, error, refetch };
}

export function usePcoRules() {
  const { data, isFetching, isError, refetch } = useQuery<PcoRules>({
    queryKey: PCO_RULES,
    queryFn: getPcoRules,
    networkMode: 'always',
    refetchOnWindowFocus: false,
    retry: 3,
  });

  return { data, isFetching, isError, refetch };
}

export function usePcoRulesMutation() {
  const { isPending, mutateAsync } = useMutation({
    mutationFn: editPcoRules,
    onError: (error) => logAxiosError('Error saving Planning Center settings', error),
    onSuccess: (data) => {
      ontimeQueryClient.setQueryData(PCO_RULES, data);
      // the rules decide which service type is resolved and which rule claims an item
      ontimeQueryClient.invalidateQueries({ queryKey: PCO_STATUS });
      ontimeQueryClient.invalidateQueries({ queryKey: PCO_KNOWN_ITEMS });
    },
  });

  return { isPending, mutateAsync };
}

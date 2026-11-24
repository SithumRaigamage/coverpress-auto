import { useQuery, type Query, type QueryKey } from '@tanstack/react-query';

export type PollInterval<T> = number | false | ((query: Query<T, Error, T, QueryKey>) => number | false);

/** Poll only while enabled. Pass a predicate to stop automatically when work drains. */
export function usePolling<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  enabled: boolean,
  interval: PollInterval<T> = 2000,
) {
  return useQuery<T>({
    queryKey,
    queryFn,
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? interval : false,
    refetchIntervalInBackground: false,
  });
}

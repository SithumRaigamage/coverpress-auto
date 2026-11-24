/** Query keys and read hooks. No fetch calls live here beyond api/client. */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { CoverRun, CoversResponse, LibraryFilters, RunsResponse } from './types';
import { isBusy } from '../lib/status';

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  library: (filters: LibraryFilters) => ['library', filters] as const,
  libraryAll: ['library'] as const,
  game: (id: string) => ['game', id] as const,
  gameArt: (id: string) => ['game', id, 'art'] as const,
  covers: (projectId?: string) => ['covers', projectId || 'all'] as const,
  coversAll: ['covers'] as const,
  cover: (id: string) => ['cover', id] as const,
  run: (id: string) => ['run', id] as const,
  runs: ['runs'] as const,
  print: (id: string) => ['print', id] as const,
  legal: ['legal'] as const,
  settings: ['settings'] as const,
  llm: ['settings', 'llm'] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: api.me, staleTime: 5000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: api.projects, staleTime: 5000 });
}

/** Infinite RAWG library. Pages are cached server-side too, so scrolling back is free. */
export function useLibrary(filters: LibraryFilters) {
  return useInfiniteQuery({
    queryKey: qk.library(filters),
    queryFn: ({ pageParam }) => api.rawgSearch(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.next ? last.page + 1 : undefined),
    staleTime: 60_000,
    retry: false,
  });
}

export function useGame(rawgId: string) {
  return useQuery({ queryKey: qk.game(rawgId), queryFn: () => api.game(rawgId), staleTime: 60_000, retry: false });
}

export function useGameArt(rawgId: string) {
  return useQuery({ queryKey: qk.gameArt(rawgId), queryFn: () => api.gameArt(rawgId), staleTime: 60_000, retry: false });
}

/** Every cover on every shelf. Polls while anything is building; idle otherwise. */
export function useCovers(projectId?: string) {
  return useQuery<CoversResponse>({
    queryKey: qk.covers(projectId),
    queryFn: () => api.covers(projectId),
    staleTime: 2000,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data.pending > 0 || data.covers.some((c) => isBusy(c.status))) ? 1500 : false;
    },
  });
}

/** The run screen polls once a second until the job and the cover are both settled. */
export function useCoverRun(coverId: string) {
  return useQuery<CoverRun>({
    queryKey: qk.run(coverId),
    queryFn: () => api.coverRun(coverId),
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1000;
      const jobBusy = data.run?.state === 'queued' || data.run?.state === 'running';
      return jobBusy || isBusy(data.cover.status) ? 1000 : false;
    },
  });
}

/** Sidebar live count. Fast while runs are active, a slow heartbeat otherwise. */
export function useRuns() {
  return useQuery<RunsResponse>({
    queryKey: qk.runs,
    queryFn: api.runs,
    staleTime: 1000,
    refetchInterval: (query) => ((query.state.data?.active ?? 0) > 0 ? 1500 : 15_000),
  });
}

export function usePrintPlan(projectId: string) {
  return useQuery({
    queryKey: qk.print(projectId),
    queryFn: () => api.printPlan(projectId),
    enabled: Boolean(projectId),
    staleTime: 2000,
  });
}

export function useLegal() {
  return useQuery({ queryKey: qk.legal, queryFn: api.legal, staleTime: 60_000 });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 10_000 });
}

export function useLlmSettings() {
  return useQuery({ queryKey: qk.llm, queryFn: api.llm, staleTime: 15_000, refetchInterval: 30_000, retry: false });
}

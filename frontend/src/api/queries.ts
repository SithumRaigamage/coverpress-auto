/** Query keys and read hooks. No fetch calls live here beyond api/client. */
import { useEffect, useRef } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CoverStatus, Project, ProjectStatus } from './types';
import { usePolling } from '../lib/poll';

export const qk = {
  health: ['health'] as const,
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  status: (id: string) => ['status', id] as const,
  cover: (id: string) => ['cover', id] as const,
  covers: ['cover'] as const,
  print: (id: string) => ['print', id] as const,
  legal: ['legal'] as const,
  settings: ['settings'] as const,
  llm: ['settings', 'llm'] as const,
};

export function useHealth() {
  return useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 10_000, retry: false });
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: api.me, staleTime: 2000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: api.projects, staleTime: 2000 });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.project(projectId),
    enabled: Boolean(projectId),
    staleTime: 2000,
  });
}

/** Poll every 2s while jobs are pending, stop on their own when the queue drains. */
export function useProjectStatus(projectId: string) {
  return usePolling<ProjectStatus>(
    qk.status(projectId),
    () => api.projectStatus(projectId),
    Boolean(projectId),
    (query) => {
      const data = query.state.data as ProjectStatus | undefined;
      return data && data.pending > 0 ? 2000 : false;
    },
  );
}

/** Refresh everything the worker may have changed when the queue empties. */
export function useInvalidateOnIdle(projectId: string) {
  const queryClient = useQueryClient();
  const status = useProjectStatus(projectId);
  const lastPending = useRef<number | null>(null);

  useEffect(() => {
    const pending = status.data?.pending;
    if (pending === undefined) return;
    if (lastPending.current !== null && lastPending.current > 0 && pending === 0) {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.projects });
      void queryClient.invalidateQueries({ queryKey: qk.covers });
    }
    lastPending.current = pending;
  }, [status.data?.pending, projectId, queryClient]);

  return status;
}

export function useShelfStatuses(projects: Project[]) {
  return useQueries({
    queries: projects.map((project) => ({
      queryKey: qk.status(project.id),
      queryFn: () => api.projectStatus(project.id),
      staleTime: 2000,
      retry: 1,
    })),
  });
}

export function useCoverDetail(coverId: string, busyStatus: CoverStatus | undefined) {
  return usePolling(
    qk.cover(coverId),
    () => api.cover(coverId),
    Boolean(coverId),
    (query) => {
      const data = query.state.data;
      const busy =
        busyStatus === 'queued' ||
        busyStatus === 'processing' ||
        data?.cover.status === 'queued' ||
        data?.cover.status === 'processing';
      if (!busy) return false;
      // 1.2 s, then 2.4 s, then 4.8 s (capped at 5 s); stops on a terminal status.
      const ticks = query.state.dataUpdateCount ?? 0;
      return Math.min(5000, 1200 * 2 ** Math.min(2, ticks));
    },
  );
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
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 2000 });
}

export function useLlmSettings() {
  return useQuery({ queryKey: qk.llm, queryFn: api.llm, staleTime: 5000, retry: false });
}

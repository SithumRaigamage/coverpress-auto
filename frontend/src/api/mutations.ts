/** Mutation hooks. All invalidation happens here so screens stay declarative. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './queries';
import type { Layout, LlmSettings, Overrides, Platform } from './types';

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; platform: Platform; layout: Layout }) => api.createProject(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.projects });
      void client.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useImportTitles(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (titles: string) => api.importTitles(projectId, titles),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
      void client.invalidateQueries({ queryKey: qk.status(projectId) });
      void client.invalidateQueries({ queryKey: qk.projects });
      void client.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useBuildProject(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.buildProject(projectId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.status(projectId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      accent?: string;
      mark?: string;
      edition?: string;
      address?: string;
      layout?: Layout;
      platform?: Platform;
    }) => api.patchProject(projectId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
      void client.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useUploadArt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, file }: { coverId: string; file: File }) => api.uploadArt(coverId, 'front', file),
    onSuccess: (_result, { coverId }) => {
      void client.invalidateQueries({ queryKey: qk.cover(coverId) });
      void client.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function usePatchOverrides(coverId: string, projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (overrides: Overrides) => api.patchCover(coverId, overrides),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.cover(coverId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useBuildCover(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (coverId: string) => api.buildCover(coverId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.status(projectId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useRenderCover(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, overrides }: { coverId: string; overrides: Overrides }) =>
      api.renderCover(coverId, overrides),
    onSuccess: (_result, { coverId }) => {
      void client.invalidateQueries({ queryKey: qk.cover(coverId) });
      void client.invalidateQueries({ queryKey: qk.status(projectId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useDecision(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      coverId,
      decision,
      overrides,
    }: {
      coverId: string;
      decision: 'approved' | 'rejected';
      overrides?: Overrides;
    }) => api.decideCover(coverId, decision, overrides),
    onSuccess: (_result, { coverId }) => {
      void client.invalidateQueries({ queryKey: qk.cover(coverId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
      void client.invalidateQueries({ queryKey: qk.projects });
      void client.invalidateQueries({ queryKey: qk.print(projectId) });
    },
  });
}

export function useRetryCover(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (coverId: string) => api.retryCover(coverId),
    onSuccess: (_result, coverId) => {
      void client.invalidateQueries({ queryKey: qk.cover(coverId) });
      void client.invalidateQueries({ queryKey: qk.status(projectId) });
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
      void client.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useRawgSearch() {
  return useMutation({
    mutationFn: ({ q, platform }: { q: string; platform?: string }) => api.rawgSearch(q, platform),
  });
}

export function useDeleteCover(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (coverId: string) => api.deleteCover(coverId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.project(projectId) });
      void client.invalidateQueries({ queryKey: qk.projects });
      void client.invalidateQueries({ queryKey: qk.print(projectId) });
    },
  });
}

export function useSetKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, value }: { name: 'rawg' | 'openrouter'; value: string }) => api.putKey(name, value),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.settings }),
  });
}

export function useSaveLlm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LlmSettings) => api.saveLlm(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.llm }),
  });
}

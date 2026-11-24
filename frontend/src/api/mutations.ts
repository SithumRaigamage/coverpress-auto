/** Mutation hooks. All invalidation and optimistic updates happen here so screens stay declarative. */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk } from './queries';
import type { Cover, CoverStatus, CoversResponse, CreateCoverInput, Overrides, Platform, RunMode } from './types';

/** Everything a pipeline change can move: lists, counters, the library's status pills. */
function invalidatePipeline(client: QueryClient, coverId?: string) {
  void client.invalidateQueries({ queryKey: qk.coversAll });
  void client.invalidateQueries({ queryKey: qk.runs });
  void client.invalidateQueries({ queryKey: qk.libraryAll });
  void client.invalidateQueries({ queryKey: qk.projects });
  void client.invalidateQueries({ queryKey: qk.me });
  if (coverId) {
    void client.invalidateQueries({ queryKey: qk.run(coverId) });
    void client.invalidateQueries({ queryKey: qk.cover(coverId) });
  }
}

/** Patch one cover in every cached cover list; returns a rollback. */
function patchCoverStatus(client: QueryClient, coverId: string, status: CoverStatus, extra: Partial<Cover> = {}) {
  const snapshots = client.getQueriesData<CoversResponse>({ queryKey: qk.coversAll });
  for (const [key, data] of snapshots) {
    if (!data) continue;
    client.setQueryData<CoversResponse>(key, {
      ...data,
      covers: data.covers.map((c) => (c.id === coverId ? { ...c, status, ...extra } : c)),
    });
  }
  return () => {
    for (const [key, data] of snapshots) client.setQueryData(key, data);
  };
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; platform: Platform }) => api.createProject(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.projects });
      void client.invalidateQueries({ queryKey: qk.me });
    },
  });
}

/** "Run all steps" / "Generate cover": create (or re-run) a cover and enqueue its build. */
export function useCreateGameCover() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ rawgId, input }: { rawgId: number | string; input: CreateCoverInput }) =>
      api.createGameCover(rawgId, input),
    onSuccess: (result) => invalidatePipeline(client, result.cover.id),
  });
}

export function useBatchCovers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ games, projectId }: { games: Array<{ rawgId: number; name: string; platform: Platform }>; projectId?: string }) =>
      api.batchCovers(games, projectId),
    onSuccess: () => invalidatePipeline(client),
  });
}

export function useDraftCopy(rawgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (refresh: boolean = false) => api.draftCopy(rawgId, refresh),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.game(rawgId) }),
  });
}

/** Replay. 'variant' (default) = a new version with new art, shots, copy and
 *  layout; 'same' = re-render the stored inputs. Both are free of quota. */
export function useReplay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, mode = 'variant' }: { coverId: string; mode?: RunMode }) => api.buildCover(coverId, mode),
    onSuccess: (_r, { coverId }) => invalidatePipeline(client, coverId),
  });
}

/** Inline adjust in review: save overrides and re-render with the same art (a new version). */
export function useAdjust() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, overrides }: { coverId: string; overrides: Overrides }) => api.renderCover(coverId, overrides),
    onMutate: async ({ coverId }) => {
      await client.cancelQueries({ queryKey: qk.coversAll });
      return { rollback: patchCoverStatus(client, coverId, 'queued') };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: (_r, _e, { coverId }) => invalidatePipeline(client, coverId),
  });
}

/** Approve / reject, optimistic with rollback. */
export function useDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, decision, renderId }: { coverId: string; decision: 'approved' | 'rejected'; renderId?: string }) =>
      api.decideCover(coverId, decision, renderId),
    onMutate: async ({ coverId, decision, renderId }) => {
      await client.cancelQueries({ queryKey: qk.coversAll });
      return { rollback: patchCoverStatus(client, coverId, decision, { approvedRenderId: decision === 'approved' ? renderId || null : null }) };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: (_r, _e, { coverId }) => {
      invalidatePipeline(client, coverId);
      void client.invalidateQueries({ queryKey: ['print'] });
    },
  });
}

/** Run again / Retry all steps, optimistic with rollback. */
export function useRetry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (coverId: string) => api.retryCover(coverId),
    onMutate: async (coverId) => {
      await client.cancelQueries({ queryKey: qk.coversAll });
      return { rollback: patchCoverStatus(client, coverId, 'queued') };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: (_r, _e, coverId) => invalidatePipeline(client, coverId),
  });
}

/** The hidden override in review: replace the front art with a file. */
export function useUploadFront() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, file }: { coverId: string; file: File }) => api.uploadArt(coverId, 'front', file),
    onSuccess: (_r, { coverId }) => invalidatePipeline(client, coverId),
  });
}

/** "Generate art" on the game screen. New images land in the art grid. */
export function useGenerateArt(rawgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ prompt, count }: { prompt: string; count: number }) => api.generateArt(rawgId, prompt, count),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.gameArt(rawgId) });
      void client.invalidateQueries({ queryKey: qk.aiPrompt(rawgId) });
    },
  });
}

/** Settings → Pipeline → AI art step. */
export function useSetPipeline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (aiArt: boolean) => api.setPipeline(aiArt),
    onSuccess: () => void client.invalidateQueries({ queryKey: qk.settings }),
  });
}

/* ------------------------------------------------------------- deleting */

/** Drop covers from every cached cover list at once; returns a rollback. */
function removeCovers(client: QueryClient, ids: string[]) {
  const gone = new Set(ids);
  const snapshots = client.getQueriesData<CoversResponse>({ queryKey: qk.coversAll });
  for (const [key, data] of snapshots) {
    if (!data) continue;
    client.setQueryData<CoversResponse>(key, { ...data, covers: data.covers.filter((c) => !gone.has(c.id)) });
  }
  return () => {
    for (const [key, data] of snapshots) client.setQueryData(key, data);
  };
}

/** Everything a delete can change, including print sheets and shelf mosaics. */
function invalidateAfterDelete(client: QueryClient) {
  invalidatePipeline(client);
  void client.invalidateQueries({ queryKey: ['print'] });
  void client.invalidateQueries({ queryKey: ['project'] });
  void client.invalidateQueries({ queryKey: ['run'] });
  void client.invalidateQueries({ queryKey: ['cover'] });
}

/** One cover with every version. Optimistic: the card disappears at once. */
export function useDeleteCover() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (coverId: string) => api.deleteCover(coverId),
    onMutate: async (coverId) => {
      await client.cancelQueries({ queryKey: qk.coversAll });
      return { rollback: removeCovers(client, [coverId]) };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: () => invalidateAfterDelete(client),
  });
}

/** "Clear" on a review column. Covers that are building come back as skipped. */
export function useDeleteCovers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteCovers(ids),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: qk.coversAll });
      return { rollback: removeCovers(client, ids) };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: () => invalidateAfterDelete(client),
  });
}

export function useDeleteVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ coverId, renderId }: { coverId: string; renderId: string }) => api.deleteVersion(coverId, renderId),
    onSettled: (_r, _e, { coverId }) => {
      invalidatePipeline(client, coverId);
      void client.invalidateQueries({ queryKey: ['print'] });
    },
  });
}

export function useDeleteRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.deleteRun(runId),
    onSettled: (r) => invalidatePipeline(client, r?.coverId),
  });
}

export function useClearRuns() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearRuns(),
    onSettled: () => {
      invalidatePipeline(client);
      void client.invalidateQueries({ queryKey: ['run'] });
    },
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSettled: () => invalidateAfterDelete(client),
  });
}

/** AI drafts on the game screen: one image, or all of them. */
export function useDeleteAiArt(rawgId: string) {
  const client = useQueryClient();
  return useMutation({
    /** Resolves to how many images went. */
    mutationFn: async (target: { url: string } | 'all'): Promise<{ deleted: number }> => {
      if (target === 'all') return api.clearAiArt(rawgId);
      await api.deleteAiImage(target.url);
      return { deleted: 1 };
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.gameArt(rawgId) }),
  });
}

/** Settings → Danger zone. Clears every cache that could still show deleted work. */
export function useDeleteEverything() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (aiArt: boolean) => api.deleteEverything(aiArt),
    onSettled: () => {
      invalidateAfterDelete(client);
      void client.invalidateQueries({ queryKey: ['game'] });
    },
  });
}

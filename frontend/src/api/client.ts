/** The only module allowed to call fetch. */
import type {
  Account,
  AiArtResult,
  AiPrompt,
  ArtUploadResult,
  BackCopy,
  BatchResult,
  CoverDetail,
  CoverRun,
  CoverVersion,
  RunMode,
  CoversResponse,
  CoverStatus,
  CreateCoverInput,
  CreateCoverResult,
  GameArt,
  GameResponse,
  ImportResult,
  LegalDoc,
  LibraryFilters,
  LlmSettings,
  Overrides,
  Platform,
  Layout,
  PrintPlan,
  Project,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectStatus,
  RawgSearchPage,
  RunsResponse,
  Settings,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  Object.assign(headers, init.headers as Record<string, string> | undefined);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach the API. Is the local server running on port 3000?", 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Non-JSON error — keep the status-based message.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const segment = (value: string | number) => encodeURIComponent(String(value));
const body = (value: unknown) => JSON.stringify(value);

function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => request<{ ok: true }>('/health'),
  me: () => request<{ account: Account }>('/me'),
  legal: () => request<LegalDoc>('/legal'),

  projects: () => request<ProjectListResponse>('/projects'),
  createProject: (input: { name: string; platform: Platform; layout?: Layout }) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: body(input) }),
  project: (id: string) => request<ProjectDetailResponse>(`/projects/${segment(id)}`),
  importTitles: (id: string, titles: string) =>
    request<ImportResult>(`/projects/${segment(id)}/import`, { method: 'POST', body: body({ titles }) }),
  projectStatus: (id: string) => request<ProjectStatus>(`/projects/${segment(id)}/status`),
  printPlan: (id: string) => request<PrintPlan>(`/projects/${segment(id)}/print`),

  /* Library and games */
  rawgSearch: (filters: LibraryFilters, page = 1) =>
    request<RawgSearchPage>(
      `/rawg/search${query({ q: filters.q, platform: filters.platform, genre: filters.genre, year: filters.year, ordering: filters.ordering, page })}`,
    ),
  game: (rawgId: number | string) => request<GameResponse>(`/games/${segment(rawgId)}`),
  gameArt: (rawgId: number | string) => request<GameArt>(`/games/${segment(rawgId)}/art`),
  aiPrompt: (rawgId: number | string, refresh = false) =>
    request<AiPrompt>(`/games/${segment(rawgId)}/ai-prompt${refresh ? '?refresh=1' : ''}`),
  generateArt: (rawgId: number | string, prompt: string, count = 2) =>
    request<AiArtResult>(`/games/${segment(rawgId)}/ai-art`, { method: 'POST', body: body({ prompt, count }) }),
  draftCopy: (rawgId: number | string, refresh = false) =>
    request<BackCopy>(`/games/${segment(rawgId)}/copy`, { method: 'POST', body: body({ refresh }) }),
  createGameCover: (rawgId: number | string, input: CreateCoverInput) =>
    request<CreateCoverResult>(`/games/${segment(rawgId)}/covers`, { method: 'POST', body: body(input) }),
  batchCovers: (games: Array<{ rawgId: number; name: string; platform: Platform }>, projectId?: string) =>
    request<BatchResult>('/covers/batch', { method: 'POST', body: body({ games, projectId }) }),

  /* Covers and runs */
  covers: (projectId?: string) => request<CoversResponse>(`/covers${query({ projectId })}`),
  cover: (id: string) => request<CoverDetail>(`/covers/${segment(id)}`),
  coverRun: (id: string) => request<CoverRun>(`/covers/${segment(id)}/run`),
  runs: () => request<RunsResponse>('/runs'),
  /** variant = new art, shots, copy and layout; same = re-render the stored inputs. */
  buildCover: (id: string, mode: RunMode = 'variant') =>
    request<{ coverId: string; jobId: string; mode: RunMode; pending: number }>(`/covers/${segment(id)}/build`, {
      method: 'POST',
      body: body({ mode }),
    }),
  versions: (id: string) =>
    request<{ coverId: string; approvedRenderId: string | null; versions: CoverVersion[] }>(`/covers/${segment(id)}/versions`),
  renderCover: (id: string, overrides: Overrides) =>
    request<{ coverId: string; jobId: string; overrides: Overrides; pending: number }>(
      `/covers/${segment(id)}/render`,
      { method: 'POST', body: body({ overrides }) },
    ),
  /** Approve a specific version with renderId, or the latest without it. */
  decideCover: (id: string, decision: 'approved' | 'rejected', renderId?: string) =>
    request<{ id: string; status: CoverStatus; decidedAt: string; approvedRenderId: string | null }>(`/covers/${segment(id)}/decision`, {
      method: 'POST',
      body: body({ decision, ...(renderId ? { renderId } : {}) }),
    }),
  /** Re-run the full pipeline for an unreviewed / failed / rejected cover. */
  retryCover: (id: string) =>
    request<{ coverId: string; pending: boolean }>(`/covers/${segment(id)}/retry`, {
      method: 'POST',
      body: body({}),
    }),
  deleteCover: (id: string) =>
    request<{ deleted: string; projectId: string }>(`/covers/${segment(id)}`, { method: 'DELETE' }),
  /** Hidden override only (review board). The main flow never uploads. */
  uploadArt: (id: string, slot: string, file: File) =>
    request<ArtUploadResult>(`/covers/${segment(id)}/art/${segment(slot)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),

  settings: () => request<Settings>('/settings'),
  llm: () => request<LlmSettings>('/settings/llm'),
  setPipeline: (aiArt: boolean) =>
    request<{ pipeline: Settings['pipeline']; gemini: Settings['gemini'] }>('/settings/pipeline', { method: 'PUT', body: body({ aiArt }) }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** The only module allowed to call fetch. */
import type {
  ArtUploadResult,
  CoverDetail,
  CoverStatus,
  ImportResult,
  LlmSettings,
  LegalDoc,
  Overrides,
  Platform,
  Layout,
  PrintPlan,
  Project,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectStatus,
  RawgGame,
  Settings,
  Account,
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

const segment = (value: string) => encodeURIComponent(value);
const body = (value: unknown) => JSON.stringify(value);

export const api = {
  health: () => request<{ ok: true }>('/health'),
  me: () => request<{ account: Account }>('/me'),
  legal: () => request<LegalDoc>('/legal'),

  projects: () => request<ProjectListResponse>('/projects'),
  createProject: (input: { name: string; platform: Platform; layout: Layout }) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: body(input) }),
  project: (id: string) => request<ProjectDetailResponse>(`/projects/${segment(id)}`),
  patchProject: (
    id: string,
    input: { accent?: string; mark?: string; edition?: string; address?: string; layout?: Layout; platform?: Platform },
  ) => request<{ project: Project }>(`/projects/${segment(id)}`, { method: 'PATCH', body: body(input) }),
  importTitles: (id: string, titles: string) =>
    request<ImportResult>(`/projects/${segment(id)}/import`, { method: 'POST', body: body({ titles }) }),
  buildProject: (id: string) =>
    request<{ queued: number; pending: number }>(`/projects/${segment(id)}/build`, {
      method: 'POST',
      body: body({}),
    }),
  projectStatus: (id: string) => request<ProjectStatus>(`/projects/${segment(id)}/status`),
  printPlan: (id: string) => request<PrintPlan>(`/projects/${segment(id)}/print`),

  cover: (id: string) => request<CoverDetail>(`/covers/${segment(id)}`),
  /** Persist overrides without enqueueing a render. */
  patchCover: (id: string, overrides: Overrides) =>
    request<{ id: string; overrides: Overrides }>(`/covers/${segment(id)}`, {
      method: 'PATCH',
      body: body({ overrides }),
    }),
  buildCover: (id: string) =>
    request<{ coverId: string; jobId: string; pending: number }>(`/covers/${segment(id)}/build`, {
      method: 'POST',
      body: body({}),
    }),
  renderCover: (id: string, overrides: Overrides) =>
    request<{ coverId: string; jobId: string; overrides: Overrides; pending: number }>(
      `/covers/${segment(id)}/render`,
      { method: 'POST', body: body({ overrides }) },
    ),
  decideCover: (id: string, decision: 'approved' | 'rejected', overrides?: Overrides) =>
    request<{ id: string; status: CoverStatus; decidedAt: string }>(`/covers/${segment(id)}/decision`, {
      method: 'POST',
      body: body({ decision, ...(overrides ? { overrides } : {}) }),
    }),
  /** Re-run the full pipeline for an unreviewed / failed / rejected cover. */
  retryCover: (id: string) =>
    request<{ coverId: string; pending: boolean }>(`/covers/${segment(id)}/retry`, {
      method: 'POST',
      body: body({}),
    }),
  /** Search RAWG games using the account's stored RAWG key. */
  rawgSearch: (q: string, platform?: string) =>
    request<{ games: RawgGame[]; count: number }>(
      `/rawg/search?q=${encodeURIComponent(q)}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}`,
    ),
  deleteCover: (id: string) =>
    request<{ deleted: string; projectId: string }>(`/covers/${segment(id)}`, { method: 'DELETE' }),
  uploadArt: (id: string, slot: string, file: File) =>
    request<ArtUploadResult>(`/covers/${segment(id)}/art/${segment(slot)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),

  settings: () => request<Settings>('/settings'),
  putKey: (name: 'rawg' | 'openrouter', value: string) =>
    request<{ keys: Settings['keys'] }>('/settings/keys', {
      method: 'PUT',
      body: body({ name, value }),
    }),
  /** Optional in the current API build: 404 is a normal answer. */
  llm: async (): Promise<LlmSettings | null> => {
    try {
      return await request<LlmSettings>('/settings/llm');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  saveLlm: (input: LlmSettings) =>
    request<LlmSettings>('/settings/llm', { method: 'PUT', body: body(input) }),
  llmModels: async (): Promise<string[] | null> => {
    try {
      const data: unknown = await request<unknown>('/settings/models');
      const source = Array.isArray(data)
        ? data
        : data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)
          ? data.models
          : [];
      return source.filter((item): item is string => typeof item === 'string');
    } catch {
      return null;
    }
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

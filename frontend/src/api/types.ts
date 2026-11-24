/** DTOs mirroring the Coverpress JSON API. The only source of truth for shapes. */

export type Platform = 'PS5' | 'PS4';
export type Layout = 'auto' | 'ps4' | 'ps5';
export type CoverStatus =
  | 'queued'
  | 'processing'
  | 'auto_approved'
  | 'needs_review'
  | 'failed'
  | 'approved'
  | 'rejected';

export interface Plan {
  name: string;
  label: string;
  coversPerMonth: number;
  projects: number;
  price: number;
}

export interface Usage {
  used: number;
  limit: number;
  projects: number;
  projectLimit: number;
  /** RAWG requests made by the server this month, against the 20k free tier. */
  rawg?: { used: number; limit: number };
}

export interface Account {
  id: string;
  email: string;
  local: boolean;
  /** DEV_MODE=true: plan limits are bypassed (unlimited covers and shelves). */
  devMode?: boolean;
  plan: Plan;
  usage: Usage;
}

export interface Project {
  id: string;
  name: string;
  platform: Platform;
  layout: Layout;
  accent: string;
  mark: string;
  edition: string;
  address: string;
  coverCount?: number;
  readyCount?: number;
  createdAt: string;
  /** Extra field returned by GET /api/projects, not in the documented contract. */
  mosaics?: string[];
}

export interface QcIssue {
  level: 'fail' | 'warn' | string;
  code: string;
  msg: string;
}

export interface Cover {
  id: string;
  projectId: string;
  title: string;
  platform: Platform;
  mode: string;
  status: CoverStatus;
  error: string | null;
  score: number | null;
  issues: QcIssue[];
  decidedAt: string | null;
  createdAt: string;
  renderId: string | null;
  renderVersion: number | null;
  artUrl: string | null;
  thumbUrl: string | null;
  wrapUrl: string | null;
  projectName?: string | null;
  rawgId?: number | null;
  front?: { source: string; kind: string; width: number; height: number; fit: number | null } | null;
  style?: CoverStyle;
  /** Reviewer overrides currently applied (zoom, offsets, title size, layout seed). */
  overrides?: Overrides;
  /** The version a reviewer approved; null means "the latest". */
  approvedRenderId?: string | null;
  updatedAt?: string | null;
  /** Newest first. Present on GET /api/covers. */
  versions?: CoverVersion[];
}

export interface CoverVersion {
  id: string;
  version: number;
  createdAt: string;
  score: number | null;
  status: CoverStatus | null;
  issues: QcIssue[];
  /** 'variant' = new art/copy/layout, 'same' = re-render of stored inputs. */
  mode: 'variant' | 'same' | null;
  front: { source: string; kind: string; width: number; height: number } | null;
  approved: boolean;
  frontUrl: string;
  wrapUrl: string;
}

export type RunMode = 'variant' | 'same';

export type CoverStyle = 'standard' | 'minimal' | 'raw';

export interface StatusCover {
  id: string;
  status: CoverStatus;
  renderId: string | null;
  renderVersion: number | null;
  score: number | null;
  error: string | null;
}

export interface ProjectStatus {
  pending: number;
  covers: StatusCover[];
}

export interface QcReport {
  score?: number;
  issues?: QcIssue[];
  [key: string]: unknown;
}

export interface Overrides {
  title?: string;
  titleSize?: number;
  titleAnchor?: 'top' | 'bottom';
  titleAlign?: 'left' | 'center';
  zoom?: number;
  offX?: number;
  offY?: number;
  ribbon?: string;
  subtitle?: string;
  style?: CoverStyle;
  accent?: string;
}

export interface CoverDetail {
  cover: Cover;
  cfg: Record<string, unknown> | null;
  qc: QcReport | null;
  overrides: Overrides;
}

export interface PrintPlan {
  project: { id: string; name: string };
  paper: { size: string; orientation: string; marginMm: number; scale: number };
  trimMm: { width: number; height: number };
  bleedMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
  pages: Array<{
    coverId: string;
    title: string;
    platform: Platform;
    version: number | null;
    wrapUrl: string;
    widthMm: number;
    heightMm?: number;
  }>;
  instructions: string;
}

export interface Settings {
  account: Account;
  keys: { rawg: boolean; sgdb: boolean; gemini: boolean };
  restrictions: Array<{ name: string; reason: string }>;
  unsupported: Array<{ name: string; reason: string }>;
  storage: { dataDir: string; database: string };
}

export interface LlmSettings {
  provider: 'ollama';
  ollama: { host: string; textModel: string; visionModel: string };
  /** llava review of each rendered front (VISION_REVIEW). */
  vision: boolean;
  status?: { connected: boolean; detail: string; checkedAt: string };
}

export interface LegalSection {
  heading: string;
  bullets?: string[];
  paragraphs?: string[];
}

export interface LegalDoc {
  title: string;
  summary: string;
  sections: LegalSection[];
  contact: string | null;
}

export interface ImportResult {
  projectId: string;
  created: Array<{ id: string; title: string; platform: Platform; mode: string; status: CoverStatus }>;
  skipped: number;
  autoQueued: number;
  usage: Usage;
  message: string;
}

export interface ArtUploadResult {
  ok: boolean;
  slot: string;
  width: number;
  height: number;
  bytes: number;
  artUrl: string;
  jobId: string | null;
}

export interface ProjectListResponse {
  projects: Project[];
  usage: Usage;
  plan: Plan;
  pending: number;
}

export interface ProjectDetailResponse {
  project: Project;
  stats: { counts: Record<string, number>; total: number };
  covers: Cover[];
  pending: number;
}

export interface CoverRef {
  id: string;
  status: CoverStatus;
  thumbUrl: string | null;
  renderVersion: number | null;
  projectId: string;
}

export interface RawgGame {
  id: number;
  slug: string;
  name: string;
  released: string | null;
  year: number | null;
  genres: string[];
  rating: string | null;
  metacritic: number | null;
  backgroundImage: string | null;
  platforms: string[];
  screenshotCount: number;
  cover: CoverRef | null;
  /** From the server's disk cache; null until the game has been opened once. */
  art: { rawg: number; sgdb: number; printReady: boolean } | null;
}

export interface RawgSearchPage {
  games: RawgGame[];
  count: number;
  page: number;
  next: boolean;
  total: number;
}

export interface LibraryFilters {
  q: string;
  platform: '' | Platform;
  genre: string;
  year: string;
  ordering: string;
}

export interface GameDetail {
  id: number;
  slug: string;
  name: string;
  released: string | null;
  year: number | null;
  developer: string;
  publisher: string;
  genres: string[];
  rating: string;
  metacritic: number | null;
  description: string;
  platforms: string[];
}

export interface BackCopy {
  tagline: string;
  blurb: string;
  features: string[];
  /** 'rawg' = deterministic fallback; otherwise the model provider that drafted it. */
  source?: string;
}

export interface GameResponse {
  game: GameDetail;
  copy: BackCopy;
  covers: Cover[];
}

export interface ArtItem {
  id: string;
  source: 'RAWG' | 'SteamGridDB';
  kind: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
  fit: number;
  printReady: boolean;
}

export interface GameArt {
  items: ArtItem[];
  best: string | null;
  counts: { all: number; rawg: number; sgdb: number };
  sgdb: { enabled: boolean; error: string | null };
  panel: { widthPx: number; heightPx: number; widthMm: number; heightMm: number; dpi: number };
}

export interface CreateCoverInput {
  platform: Platform;
  style: CoverStyle;
  artId?: string | null;
  copy?: BackCopy;
  projectId?: string;
}

export interface CreateCoverResult {
  cover: Cover;
  created: boolean;
  jobId: string;
  runUrl: string;
  usage: Usage;
}

export interface BatchResult {
  projectId: string;
  created: string[];
  rerun: string[];
  skipped: number;
  usage: Usage;
  message: string;
}

export type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface RunStep {
  key: string;
  label: string;
  state: StepState;
  detail: string;
}

export interface LogLine {
  t: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  msg: string;
}

export interface JobRun {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  step: number;
  totalSteps: number;
  steps: RunStep[];
  log: LogLine[];
}

export interface CoverRun {
  cover: Cover;
  run: JobRun | null;
  steps: Array<{ key: string; label: string }>;
  qc: QcReport | null;
  render: { id: string; version: number; wrapUrl: string; frontUrl: string } | null;
  print: { trimMm: { width: number; height: number }; bleedMm: number; dpi: number };
}

export interface RunSummary {
  id: string;
  coverId: string;
  projectId: string;
  title: string;
  platform: Platform;
  coverStatus: CoverStatus;
  state: JobRun['state'];
  step: number;
  totalSteps: number;
  currentLabel: string | null;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunsResponse {
  active: number;
  runs: RunSummary[];
}

export interface CoversResponse {
  covers: Cover[];
  pending: number;
}

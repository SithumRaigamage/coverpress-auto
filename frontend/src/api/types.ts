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
}

export interface Account {
  id: string;
  email: string;
  local: boolean;
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
}

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
  keys: { rawg: boolean; openrouter: boolean };
  unsupported: Array<{ name: string; reason: string }>;
  storage: { dataDir: string; database: string };
}

export interface LlmSettings {
  provider: 'ollama' | 'openrouter';
  ollama: { host: string; textModel: string; visionModel: string };
  openrouter: { textModel: string; visionModel: string; configured?: boolean };
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

export interface RawgGame {
  id: number;
  slug: string;
  name: string;
  released: string | null;
  rating: string | null;
  metacritic: number | null;
  backgroundImage: string | null;
  platforms: string[];
}

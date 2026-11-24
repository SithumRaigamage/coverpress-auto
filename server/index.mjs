#!/usr/bin/env node
/* Coverpress API.

   Presentation is being rebuilt from scratch (docs/FRONTEND-PLAN.md), so this
   process speaks JSON only: no HTML, no templates, no static client files.

   There is no sign-up or sign-in right now. The process runs in local mode with
   a single account; every request acts as that account. Loopback binding is the
   only thing protecting it, so never expose this port without turning accounts
   back on.

     node server/index.mjs                 # http://127.0.0.1:3000
     PORT=3100 HOST=127.0.0.1 node server/index.mjs
*/

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadImage } from "@napi-rs/canvas";

import { openDb, nowIso } from "./db.mjs";
import * as repo from "./repo.mjs";
import * as auth from "./auth.mjs";
import { buildCover } from "./build.mjs";
import { createWorker, enqueueBuild, pendingJobs, latestJobForCover, activeJobs } from "./jobs.mjs";
import { llmConfig, llmOpts, publicLlmConfig } from "./llm.mjs";
import { listModels, llmCopy, RAWG_ORDERING } from "../lib/sources.mjs";
import { createCatalog } from "./catalog.mjs";
import { mergeDuplicateCovers } from "./dedupe.mjs";
import * as purge from "./purge.mjs";
import { createGenerator, MAX_PER_PRESS } from "./generated.mjs";
import { GeminiError, GEMINI_DEFAULT_MODEL } from "../lib/gemini.mjs";
import { PIPELINE_STEPS, jobRunDto, progressReporter } from "./progress.mjs";
import { STYLES } from "../lib/cover.mjs";
import { CASE } from "../lib/render.mjs";
import { LEGAL } from "./legal.mjs";
import {
  HttpError,
  MAX_UPLOAD,
  imageType,
  readBody,
  readJson,
  safeJoin,
  sameOrigin,
  sendError,
  sendJson,
  serveFile,
} from "./http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");

// PS4 and PS5 share the Blu-ray keepcase: back 128 + spine 14 + front 128 = 270 mm
// wide, 148 mm tall, plus 3 mm bleed each side. Derived from the renderer's CASE so
// the print sheet and the render can never disagree.
const TRIM = { width: CASE.panelW * 2 + CASE.spine, height: CASE.panelH };

const parse = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/* ---------------------------------------------------------- local account */

/** One account in local mode. Reuses an existing row so earlier data survives. */
export function localAccount(db, email = "local@coverpress.local") {
  const byEmail = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
  if (byEmail) return byEmail;
  const any = db.prepare("SELECT * FROM accounts ORDER BY created_at LIMIT 1").get();
  if (any) return any;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO accounts (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    email,
    "local-mode-no-password",
    "free",
    nowIso()
  );
  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
}

/* ------------------------------------------------------------- app */

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(PROJECT_ROOT, "data"));
  const ownsDb = !options.db;
  const db =
    options.db || openDb(options.dbFile || process.env.DB_FILE || path.join(dataDir, "coverpress.sqlite"));
  // AES-256-GCM needs exactly 32 bytes; an env/test passphrase is hashed into one.
  const rawSecret = options.secret || auth.loadSecret(dataDir, process.env.APP_SECRET);
  const secret =
    Buffer.isBuffer(rawSecret) && rawSecret.length === 32
      ? rawSecret
      : crypto.createHash("sha256").update(String(rawSecret)).digest();
  const logger = options.logger || console;
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN ?? "";
  const bleed = options.bleed ?? Number(process.env.BLEED_MM ?? 3);
  const legalContact = options.legalContact ?? process.env.LEGAL_CONTACT ?? "";

  // One game + platform is one cover: fold duplicates left by earlier builds into versions.
  mergeDuplicateCovers(db, logger);

  const initial = options.account || localAccount(db, options.localEmail || process.env.LOCAL_EMAIL);
  const initialId = initial.id;

  // Re-read the row on each use: an operator can change the plan with the CLI
  // while this process is running, and quota must follow without a restart.
  const account = () =>
    db.prepare("SELECT * FROM accounts WHERE id = ?").get(initialId) || { ...initial, plan: "free" };

  // Every server-side RAWG request is counted against the 20k/month free tier.
  const onRawgCall = () => auth.recordUsage(db, account().id, "rawg.request");
  // AI art (Gemini). Server-side only; off when GEMINI_API_KEY is unset.
  const generator = createGenerator({
    dataDir,
    key: () => auth.providerKey(db, account().id, "gemini"),
    model: () => String(process.env.GEMINI_IMAGE_MODEL || GEMINI_DEFAULT_MODEL).trim() || GEMINI_DEFAULT_MODEL,
    logger,
  });
  /** Settings → Pipeline → "Generate AI art during runs". Stored per account, not a secret. */
  const aiStepOn = () => repo.getSettings(db, account().id).aiArtStep === "true";

  const catalog =
    options.catalog ||
    createCatalog({
      generated: generator,
      dataDir,
      keys: {
        rawg: () => auth.providerKey(db, account().id, "rawg"),
        // Personal use only — see docs/LEGAL-AND-VIABILITY.md. Off unless SGDB_KEY is set.
        sgdb: () => auth.providerKey(db, account().id, "sgdb"),
      },
      onRawgCall,
      logger,
    });

  const worker = createWorker({
    db,
    intervalMs: options.workerIntervalMs ?? 300,
    logger,
    run: (job) =>
      buildCover({
        db,
        dataDir,
        secret,
        accountId: job.account_id,
        coverId: job.cover_id,
        logger,
        bleed,
        reporter: progressReporter(db, job.id),
        attempt: job.attempts,
        kind: job.kind,
        catalog,
        aiArt: aiStepOn() ? (args) => generator.pipelineStep(args) : null,
        onRawgCall,
      }),
  });

  const planInfo = () => {
    const row = account();
    const plan = auth.planOf(row);
    return {
      name: row.plan,
      label: plan.label,
      coversPerMonth: plan.coversPerMonth,
      projects: plan.projects,
      price: plan.price,
    };
  };

  const usage = () => {
    const row = account();
    const plan = auth.planOf(row);
    return {
      used: auth.usageThisMonth(db, row.id),
      limit: plan.coversPerMonth,
      projects: auth.projectCount(db, row.id),
      projectLimit: plan.projects,
      rawg: { used: auth.rawgCallsThisMonth(db, row.id), limit: auth.RAWG_MONTHLY_LIMIT },
    };
  };

  const accountDto = () => ({
    id: account().id,
    email: account().email,
    local: true,
    // Plan limits are bypassed; the UI hides the cover meter and plan label.
    devMode: auth.devMode(),
    plan: planInfo(),
    usage: usage(),
  });

  /* --------------------------------------------------------------- DTOs */

  const coverDto = (c, extra = {}) => {
    const qc = parse(c.qc);
    const source = parse(c.source) || {};
    const overrides = parse(c.overrides) || {};
    return {
      id: c.id,
      projectId: c.project_id,
      title: c.title,
      platform: c.platform,
      mode: c.mode,
      status: c.status,
      error: c.error || null,
      score: qc && Number.isFinite(qc.score) ? qc.score : null,
      issues: qc?.issues || [],
      decidedAt: c.decided_at || null,
      createdAt: c.created_at,
      renderId: c.render_id || extra.renderId || null,
      renderVersion: c.render_version || extra.renderVersion || null,
      artUrl: c.art_path ? `/api/covers/${c.id}/art/front` : null,
      thumbUrl: c.render_id ? `/api/renders/${c.render_id}/front.png` : null,
      wrapUrl: c.render_id ? `/api/renders/${c.render_id}/wrap.png` : null,
      projectName: c.project_name || null,
      rawgId: Number.isInteger(source.rawgId) ? source.rawgId : null,
      front: source.front
        ? { source: source.front.source, kind: source.front.kind, width: source.front.width, height: source.front.height, fit: source.front.fit ?? null }
        : null,
      style: STYLES.has(overrides.style) ? overrides.style : "standard",
      overrides: keptOverrides(overrides),
      approvedRenderId: c.approved_render_id || null,
      updatedAt: c.updated_at || null,
    };
  };

  /** One version of a cover for the review switcher. `cover` is the covers row. */
  const versionDto = (r, cover) => {
    const qc = parse(r.qc) || {};
    const meta = parse(r.meta) || {};
    return {
      id: r.id,
      version: r.version,
      createdAt: r.created_at,
      score: Number.isFinite(qc.score) ? qc.score : null,
      status: qc.status || null,
      issues: qc.issues || [],
      mode: meta.mode || null,
      front: meta.front ? { source: meta.front.source, kind: meta.front.kind, width: meta.front.width, height: meta.front.height } : null,
      approved: Boolean(cover.approved_render_id) && cover.approved_render_id === r.id,
      frontUrl: `/api/renders/${r.id}/front.png`,
      wrapUrl: `/api/renders/${r.id}/wrap.png`,
    };
  };

  const projectDto = (p) => ({
    id: p.id,
    name: p.name,
    platform: p.platform,
    layout: p.layout,
    accent: p.accent,
    mark: p.mark,
    edition: p.edition,
    address: p.address,
    coverCount: p.cover_count === undefined ? undefined : Number(p.cover_count),
    readyCount: p.ready_count === undefined ? undefined : Number(p.ready_count),
    createdAt: p.created_at,
  });

  async function projectOr404(projectId) {
    const project = repo.getProject(db, account().id, projectId);
    if (!project) throw new HttpError(404, "Project not found.");
    return project;
  }

  async function coverOr404(coverId) {
    const cover = repo.getCover(db, account().id, coverId);
    if (!cover) throw new HttpError(404, "Cover not found.");
    return cover;
  }

  /* ------------------------------------------------------------- routes */

  async function root(req, res) {
    return sendJson(res, 200, {
      name: "Coverpress API",
      version: "3.0.0",
      mode: "local",
      note: "Single-account local mode. No HTML is served here; see docs/FRONTEND-PLAN.md.",
      endpoints: [
        "GET /api/health",
        "GET /api/me",
        "GET /api/legal",
        "GET /api/projects",
        "POST /api/projects",
        "GET /api/projects/:id",
        "PATCH /api/projects/:id",
        "POST /api/projects/:id/import",
        "POST /api/projects/:id/build",
        "GET /api/projects/:id/status",
        "GET /api/projects/:id/print",
        "GET /api/covers/:id",
        "PATCH /api/covers/:id",
        "POST /api/covers/:id/build",
        "POST /api/covers/:id/render",
        "POST /api/covers/:id/decision",
        "POST /api/covers/:id/retry",
        "GET /api/covers/:id/versions",
        "DELETE /api/covers/:id",
        "POST /api/covers/delete",
        "DELETE /api/covers/:id/versions/:renderId",
        "DELETE /api/projects/:id",
        "DELETE /api/runs",
        "DELETE /api/runs/:id",
        "DELETE /api/generated/:rawgId/:file",
        "DELETE /api/games/:rawgId/ai-art",
        "POST /api/reset",
        "PUT /api/covers/:id/art/:slot",
        "GET /api/covers/:id/art/:slot",
        "GET /api/renders/:id/:file",
        "GET /api/settings",
        "GET /api/settings/llm",
        "GET /api/settings/models",
        "GET /api/rawg/search",
        "GET /api/games/:rawgId",
        "GET /api/games/:rawgId/art",
        "GET /api/games/:rawgId/ai-prompt",
        "POST /api/games/:rawgId/ai-art",
        "GET /api/generated/:rawgId/:file",
        "PUT /api/settings/pipeline",
        "POST /api/games/:rawgId/copy",
        "POST /api/games/:rawgId/covers",
        "GET /api/covers",
        "POST /api/covers/batch",
        "GET /api/covers/:id/run",
        "GET /api/runs",
      ],
    });
  }

  const health = async (req, res) => sendJson(res, 200, { ok: true });
  const me = async (req, res) => sendJson(res, 200, { account: accountDto() });
  const legal = async (req, res) => sendJson(res, 200, { ...LEGAL, contact: legalContact || null });

  async function listProjects(req, res) {
    const mosaics = repo.projectMosaics(db, account().id, 3);
    const projects = repo.listProjects(db, account().id).map((p) => ({
      ...projectDto(p),
      mosaics: (mosaics[p.id] || []).map((id) => `/api/renders/${id}/front.png`),
    }));
    return sendJson(res, 200, { projects, usage: usage(), plan: planInfo(), pending: pendingJobs(db, account().id) });
  }

  async function createProject(req, res) {
    const body = await readJson(req);
    const plan = auth.planOf(account());
    if (!auth.devMode() && auth.projectCount(db, account().id) >= plan.projects) {
      throw new HttpError(402, `The ${plan.label} plan includes ${plan.projects} projects.`);
    }
    const name = String(body.name || "").trim();
    if (!name) throw new HttpError(400, "A project needs a name.");
    const project = repo.createProject(db, account().id, {
      name,
      platform: body.platform,
      layout: body.layout || "auto",
    });
    return sendJson(res, 201, { project: projectDto({ ...project, cover_count: 0, ready_count: 0 }) });
  }

  async function getProject(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const covers = repo.listCoversWithRender(db, account().id, project.id).map((c) => coverDto(c));
    return sendJson(res, 200, {
      project: projectDto(project),
      stats: repo.projectSummary(db, account().id, project.id),
      covers,
      pending: pendingJobs(db, account().id),
    });
  }

  async function patchProject(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const body = await readJson(req);
    const updated = repo.updateProjectTheme(db, account().id, project.id, body);
    return sendJson(res, 200, { project: projectDto(updated) });
  }

  async function importTitles(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const body = await readJson(req);
    const lines = (Array.isArray(body.titles) ? body.titles.join("\n") : String(body.titles || ""))
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    const plan = auth.planOf(account());
    const room = auth.devMode() ? Infinity : Math.max(0, plan.coversPerMonth - auth.usageThisMonth(db, account().id));

    const created = [];
    let skipped = 0;
    let autoQueued = 0;

    let duplicates = 0;
    for (const line of lines) {
      const [title, platform, mode] = line.split("|").map((s) => s.trim());
      if (!title) continue;
      // One game + platform is one cover. A repeat is not a new cover (and costs no quota).
      if (repo.coverForTitle(db, account().id, title, platform === "PS4" ? "PS4" : platform === "PS5" ? "PS5" : project.platform)) {
        duplicates += 1;
        continue;
      }
      if (created.length >= room) {
        skipped += 1;
        continue;
      }
      const cover = repo.createCover(db, account().id, project.id, {
        title,
        platform: platform || project.platform,
        mode: mode === "auto" ? "auto" : "manual",
      });
      if (!cover) break;
      auth.recordUsage(db, account().id, "cover.created", cover.id);
      if (cover.mode === "auto") {
        enqueueBuild(db, account().id, cover.id);
        autoQueued += 1;
      }
      created.push({ id: cover.id, title: cover.title, platform: cover.platform, mode: cover.mode, status: cover.status });
    }

    return sendJson(res, 201, {
      projectId: project.id,
      created,
      skipped,
      duplicates,
      autoQueued,
      usage: usage(),
      message:
        created.length || skipped || duplicates
          ? `${created.length} cover${created.length === 1 ? "" : "s"} added` +
            (autoQueued ? `, ${autoQueued} fetching metadata` : "") +
            (duplicates ? `, ${duplicates} already on a shelf` : "") +
            (skipped ? `, ${skipped} held back by the ${plan.coversPerMonth}-cover limit` : "")
          : "No titles found in the request.",
    });
  }

  async function buildProject(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const ids = repo.coversForBuild(db, account().id, project.id);
    for (const row of ids) enqueueBuild(db, account().id, row.id);
    return sendJson(res, 202, { queued: ids.length, pending: pendingJobs(db, account().id) });
  }

  async function projectStatus(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const covers = repo.listCoversWithRender(db, account().id, project.id).map((c) => ({
      id: c.id,
      status: c.status,
      renderId: c.render_id || null,
      renderVersion: c.render_version || null,
      score: (parse(c.qc) || {}).score ?? null,
      error: c.error || null,
    }));
    return sendJson(res, 200, { pending: pendingJobs(db, account().id), covers });
  }

  async function printPlan(req, res, ctx) {
    const project = await projectOr404(ctx.params.id);
    const pages = repo.approvedRenders(db, account().id, project.id).map((c) => ({
      coverId: c.cover_id,
      title: c.title,
      platform: c.platform,
      version: c.version,
      wrapUrl: `/api/renders/${c.render_id}/wrap.png`,
      widthMm: TRIM.width + bleed * 2,
      heightMm: TRIM.height + bleed * 2,
    }));
    return sendJson(res, 200, {
      project: { id: project.id, name: project.name },
      paper: { size: "A4", orientation: "landscape", marginMm: 8, scale: 100 },
      trimMm: { ...TRIM },
      panelsMm: { back: CASE.panelW, spine: CASE.spine, front: CASE.panelW },
      bleedMm: bleed,
      pageWidthMm: TRIM.width + bleed * 2,
      pageHeightMm: TRIM.height + bleed * 2,
      pages,
      instructions:
        "Print at 100% / Actual size on A4 landscape, do not fit to page. Check the 100 mm ruler, then measure 270 mm between the trim marks before cutting; fold at the two spine marks (128 mm and 142 mm from the left trim).",
    });
  }

  async function getCover(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const render = repo.latestRender(db, cover.id);
    return sendJson(res, 200, {
      cover: coverDto(
        { ...cover, render_id: render?.id || null, render_version: render?.version || null, art_path: repo.artFor(db, cover.id, "front")?.path || null },
        { renderId: render?.id, renderVersion: render?.version }
      ),
      cfg: render ? parse(render.cfg) : null,
      qc: render ? parse(render.qc) : null,
      overrides: repo.coverOverrides(cover),
    });
  }

  async function patchCover(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const body = await readJson(req);
    const merged = { ...repo.coverOverrides(cover), ...(body.overrides || body) };
    repo.setCoverOverrides(db, cover.id, keptOverrides(merged));
    return sendJson(res, 200, { id: cover.id, overrides: keptOverrides(merged) });
  }

  /** Replay. `mode: "variant"` (the UI default) makes a new version with the
   *  next-best art, other screenshots, fresh copy and a new layout seed;
   *  `mode: "same"` re-renders the stored inputs ("Run again with same art"). */
  async function buildCoverRoute(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const body = await readJson(req);
    const mode = body.mode === "variant" ? "variant" : "same";
    const jobId = enqueueBuild(db, account().id, cover.id, mode === "variant" ? "variant" : "build");
    return sendJson(res, 202, { coverId: cover.id, jobId, mode, pending: pendingJobs(db, account().id) });
  }

  async function rerenderCover(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const body = await readJson(req);
    const patch = body.overrides || body;
    const merged = keptOverrides({ ...repo.coverOverrides(cover), ...patch });
    repo.setCoverOverrides(db, cover.id, merged);
    const jobId = enqueueBuild(db, account().id, cover.id);
    return sendJson(res, 202, { coverId: cover.id, jobId, overrides: merged, pending: pendingJobs(db, account().id) });
  }

  async function decideCover(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const body = await readJson(req);
    const decision = String(body.decision || "");
    if (decision !== "approved" && decision !== "rejected") {
      throw new HttpError(400, "Decision must be approved or rejected.");
    }
    if (body.overrides && typeof body.overrides === "object") {
      repo.setCoverOverrides(db, cover.id, keptOverrides({ ...repo.coverOverrides(cover), ...body.overrides }));
    }
    // Any version can be approved; without renderId the latest is.
    let renderId = "";
    if (decision === "approved" && body.renderId) {
      const v = repo.listVersions(db, account().id, cover.id).find((r) => r.id === String(body.renderId));
      if (!v) throw new HttpError(400, "That version does not belong to this cover.");
      renderId = v.id;
    }
    const updated = repo.setCoverDecision(db, account().id, cover.id, decision, renderId);
    if (!updated) throw new HttpError(400, "Decision must be approved or rejected.");
    return sendJson(res, 200, {
      id: updated.id,
      status: updated.status,
      decidedAt: updated.decided_at,
      approvedRenderId: updated.approved_render_id || null,
    });
  }

  /** Every version of a cover, newest first, with QC and what went into it. */
  async function listCoverVersions(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const versions = repo.listVersions(db, account().id, cover.id).map((r) => versionDto(r, cover));
    return sendJson(res, 200, { coverId: cover.id, approvedRenderId: cover.approved_render_id || null, versions });
  }

  /** "Run again": a new variant (next-best art, other shots, fresh copy, new
   *  layout seed) that returns to review as a new version. Earlier versions stay. */
  async function retryCover(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    if (["queued", "processing"].includes(cover.status)) {
      throw new HttpError(409, "This cover is already building.");
    }
    // Send it back to review so the full pipeline runs again on the next build.
    repo.setCoverStatus(db, cover.id, "needs_review", { error: "", qc: null });
    db.prepare("UPDATE covers SET decided_at = '', updated_at = ? WHERE id = ?").run(
      nowIso(),
      cover.id
    );
    const jobId = enqueueBuild(db, account().id, cover.id, "variant");
    return sendJson(res, 202, { coverId: cover.id, jobId, mode: "variant", pending: true });
  }

  /* ------------------------------------------------------------ deleting */

  const purged = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof purge.PurgeError) throw new HttpError(err.status, err.message);
      throw err;
    }
  };

  /** One cover, every version, its art and its runs. 409 while it is building. */
  async function deleteCover(req, res, ctx) {
    return sendJson(res, 200, await purged(() => purge.deleteCover(db, dataDir, account().id, ctx.params.id)));
  }

  /** Several covers, e.g. "Clear" on a review column. Building covers are skipped. */
  async function bulkDeleteCovers(req, res) {
    const body = await readJson(req);
    return sendJson(res, 200, await purged(() => purge.deleteCovers(db, dataDir, account().id, body.ids)));
  }

  /** One version of a cover. Never the last one; the approved one sends the cover back to review. */
  async function deleteCoverVersion(req, res, ctx) {
    return sendJson(res, 200, await purged(() => purge.deleteVersion(db, dataDir, account().id, ctx.params.id, ctx.params.slot)));
  }

  /** One run from the history; a queued run is cancelled. */
  async function deleteRunRoute(req, res, ctx) {
    return sendJson(res, 200, await purged(async () => purge.deleteRun(db, account().id, ctx.params.id)));
  }

  /** Clear finished runs from the history. Active runs stay. */
  async function clearRunsRoute(req, res) {
    return sendJson(res, 200, purge.clearRuns(db, account().id));
  }

  /** A shelf and every cover on it. */
  async function deleteProjectRoute(req, res, ctx) {
    return sendJson(res, 200, await purged(() => purge.deleteProject(db, dataDir, account().id, ctx.params.id)));
  }

  /** One AI-generated image (a draft). */
  async function deleteGenerated(req, res, ctx) {
    const ok = await generator.remove(ctx.params.id, ctx.params.file);
    if (!ok) throw new HttpError(404, "Unknown generated image.");
    return sendJson(res, 200, { deleted: ctx.params.file });
  }

  /** Every AI-generated image for a game. The saved prompt stays. */
  async function clearGenerated(req, res, ctx) {
    if (!/^\d+$/.test(String(ctx.params.id))) throw new HttpError(400, "Bad game id.");
    return sendJson(res, 200, { deleted: await generator.clear(ctx.params.id) });
  }

  /** Settings → Danger zone. Needs { confirm: "DELETE" }; aiArt: true also removes AI images. */
  async function deleteEverything(req, res) {
    const body = await readJson(req);
    if (body.confirm !== "DELETE") throw new HttpError(400, 'Type DELETE to confirm.');
    const out = await purged(() => purge.deleteEverything(db, dataDir, account().id, { aiArt: body.aiArt === true }));
    return sendJson(res, 200, out);
  }

  async function uploadArt(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const slot = String(ctx.params.slot || "");
    if (!repo.ART_SLOTS.has(slot)) throw new HttpError(400, "Unknown art slot. Use front, back, shot0..shot2.");

    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, "That upload was empty.");
    const type = imageType(buf);
    if (!type) throw new HttpError(415, "Upload a PNG, JPEG or WebP image.");

    let img;
    try {
      img = await loadImage(buf);
    } catch {
      throw new HttpError(400, "That image could not be decoded.");
    }
    if (img.width < 400 || img.height < 400) {
      throw new HttpError(400, `Art is ${img.width}×${img.height}; upload at least 400×400 px.`);
    }
    if (img.width > 12000 || img.height > 12000) {
      throw new HttpError(400, "That image is larger than 12000 px on a side.");
    }

    const rel = `art/${account().id}/${cover.id}/${slot}.${type.ext}`;
    const file = safeJoin(dataDir, rel);
    if (!file) throw new HttpError(400, "Bad upload path.");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);

    const previous = repo.artFor(db, cover.id, slot);
    if (previous && previous.path !== rel) {
      const old = safeJoin(dataDir, previous.path);
      if (old) await fs.unlink(old).catch(() => {});
    }

    repo.setArt(db, cover.id, slot, rel, { width: img.width, height: img.height, bytes: buf.length, kind: "upload" });

    // Uploading a front is the last step of the job; queue the build.
    let jobId = null;
    if (slot === "front" && cover.status !== "processing") jobId = enqueueBuild(db, account().id, cover.id);

    return sendJson(res, 200, {
      ok: true,
      slot,
      width: img.width,
      height: img.height,
      bytes: buf.length,
      artUrl: `/api/covers/${cover.id}/art/${slot}`,
      jobId,
    });
  }

  async function getArt(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const row = repo.artFor(db, cover.id, String(ctx.params.slot));
    if (!row) throw new HttpError(404, "No art in that slot.");
    const file = safeJoin(dataDir, row.path);
    const ok = file && (await serveFile(res, file));
    if (!ok) throw new HttpError(404, "Art file is missing.");
  }

  async function getRender(req, res, ctx) {
    const render = repo.getRender(db, account().id, ctx.params.id);
    if (!render) throw new HttpError(404, "Render not found.");
    const name = String(ctx.params.file);
    if (name !== "wrap.png" && name !== "front.png") throw new HttpError(404, "Unknown render file.");
    const file = safeJoin(dataDir, name === "wrap.png" ? render.wrap_path : render.front_path);
    const ok = file && (await serveFile(res, file));
    if (!ok) throw new HttpError(404, "Render file is missing.");
  }

  async function getSettings(req, res) {
    const names = auth.providerKeyNames(db, account().id);
    return sendJson(res, 200, {
      account: accountDto(),
      keys: { rawg: names.has("rawg"), sgdb: names.has("sgdb"), gemini: names.has("gemini") },
      // Providers with use restrictions the UI must state next to their status.
      restrictions: [{ name: "sgdb", reason: "SteamGridDB terms allow personal, non-commercial use only. Leave SGDB_KEY unset in any hosted or paid deployment." }],
      unsupported: [],
      storage: { dataDir: path.basename(dataDir), database: "sqlite" },
      gemini: { configured: generator.enabled(), model: generator.model() },
      pipeline: { aiArt: aiStepOn() },
      llm: publicLlmConfig(llmConfig(db, account().id, secret)),
    });
  }

  // The sidebar's "Ollama connected" dot must be real, so the LLM settings carry
  // a reachability probe. Cached briefly: the sidebar asks on every page.
  let probeCache = { at: 0, key: "", value: null };
  async function probeLlm(config) {
    const key = config.ollama.host;
    if (probeCache.value && probeCache.key === key && Date.now() - probeCache.at < 15_000) return probeCache.value;
    let value;
    try {
      const res = await fetch(`${config.ollama.host.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(1500) });
      value = res.ok ? { connected: true, detail: "Ollama answered" } : { connected: false, detail: `Ollama returned ${res.status}` };
    } catch {
      value = { connected: false, detail: `No answer from ${config.ollama.host}` };
    }
    value = { ...value, checkedAt: new Date().toISOString() };
    probeCache = { at: Date.now(), key, value };
    return value;
  }

  async function getLlmSettings(req, res) {
    const config = llmConfig(db, account().id, secret);
    return sendJson(res, 200, { ...publicLlmConfig(config), status: await probeLlm(config) });
  }

  /** Explicit opt-in network call for API clients that want model discovery. */
  async function getLlmModels(req, res) {
    const config = llmConfig(db, account().id, secret);
    try {
      const models = await listModels(llmOpts(config, "text"));
      return sendJson(res, 200, { provider: config.provider, models });
    } catch (err) {
      throw new HttpError(502, `Could not reach the ${config.provider} model list: ${err.message}`);
    }
  }

  /* ------------------------------------------------- catalog and library */

  /** Catalog errors carry a status (400 for a missing key); anything else is upstream. */
  async function fromCatalog(fn, upstream = "RAWG") {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err.status) throw new HttpError(err.status, err.message);
      throw new HttpError(502, `${upstream} request failed: ${err.message}`);
    }
  }

  /** rawgId → the account's newest cover for it, for status pills on library cards. */
  function coversByRawg() {
    const out = new Map();
    for (const c of repo.listAccountCovers(db, account().id)) {
      const rawgId = (parse(c.source) || {}).rawgId;
      if (Number.isInteger(rawgId) && !out.has(rawgId)) out.set(rawgId, coverDto(c));
    }
    return out;
  }

  const coverRef = (c) =>
    c ? { id: c.id, status: c.status, thumbUrl: c.thumbUrl, renderVersion: c.renderVersion, projectId: c.projectId } : null;

  /** Search, or browse popular PS5/PS4 games when the query is empty. Paged for infinite scroll. */
  async function getRawgSearch(req, res, ctx) {
    const q = String(ctx.query.get("q") || "").trim().slice(0, 120);
    const platform = ["PS5", "PS4"].includes(ctx.query.get("platform")) ? ctx.query.get("platform") : "";
    const page = Math.max(1, Math.min(500, Number(ctx.query.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(40, Number(ctx.query.get("pageSize")) || 20));
    const genre = /^[a-z0-9-]{1,40}$/.test(ctx.query.get("genre") || "") ? ctx.query.get("genre") : "";
    const year = /^\d{4}$/.test(ctx.query.get("year") || "") ? ctx.query.get("year") : "";
    const ordering = RAWG_ORDERING.has(ctx.query.get("ordering")) ? ctx.query.get("ordering") : "";

    const result = await fromCatalog(() => catalog.search({ q, platform, page, pageSize, genre, year, ordering }));
    const covers = coversByRawg();
    const games = await Promise.all(
      result.games.map(async (g) => ({ ...g, cover: coverRef(covers.get(g.id)), art: await catalog.summary(g.id) }))
    );
    return sendJson(res, 200, { games, count: games.length, page, next: result.next, total: result.total });
  }

  async function getGame(req, res, ctx) {
    const g = await fromCatalog(() => catalog.game(ctx.params.id));
    const m = g.meta;
    const covers = repo
      .listAccountCovers(db, account().id)
      .filter((c) => (parse(c.source) || {}).rawgId === m.id)
      .map((c) => coverDto(c));
    return sendJson(res, 200, {
      game: {
        id: m.id,
        slug: m.slug,
        name: m.name,
        released: m.released,
        year: m.released ? Number(String(m.released).slice(0, 4)) : null,
        developer: m.developer || m.publisher || "",
        publisher: m.publisher || "",
        genres: m.genres,
        rating: m.rating,
        metacritic: m.metacritic ?? null,
        description: m.description.slice(0, 2000),
        platforms: g.platforms || [],
      },
      copy: (await catalog.cachedCopy(m.id)) || { ...catalog.fallbackCopy(m), source: "rawg" },
      covers,
    });
  }

  async function getGameArt(req, res, ctx) {
    const art = await fromCatalog(() => catalog.art(ctx.params.id));
    return sendJson(res, 200, { ...art, panel: { widthPx: 1512, heightPx: 1748, widthMm: 128, heightMm: 148, dpi: 300 } });
  }

  /** Draft back-cover copy with the configured language model; RAWG fallback otherwise. Cached per game. */
  async function draftGameCopy(req, res, ctx) {
    const g = await fromCatalog(() => catalog.game(ctx.params.id));
    const body = await readJson(req);
    const cached = await catalog.cachedCopy(g.meta.id);
    if (cached && !body.refresh) return sendJson(res, 200, cached);
    const llm = llmConfig(db, account().id, secret);
    const copy = await llmCopy(g.meta, llmOpts(llm, "text")).catch(() => null);
    const clean = copy ? cleanCopy(copy) : null;
    if (clean) {
      const value = { ...clean, source: llm.provider };
      await catalog.saveCopy(g.meta.id, value);
      return sendJson(res, 200, value);
    }
    return sendJson(res, 200, { ...catalog.fallbackCopy(g.meta), source: "rawg" });
  }

  /** The project new covers land in: the one asked for, or the account's first shelf (created if none). */
  async function targetProject(projectId) {
    if (projectId) return projectOr404(String(projectId));
    const all = repo.listProjects(db, account().id);
    if (all.length) return all[all.length - 1];
    return repo.createProject(db, account().id, { name: "My library", platform: "PS5" });
  }

  const coverRoom = () =>
    auth.devMode() ? Infinity : Math.max(0, auth.planOf(account()).coversPerMonth - auth.usageThisMonth(db, account().id));

  /** Create (or re-run) a cover from a RAWG game with the art, layout and copy picked on the game screen. */
  async function createGameCover(req, res, ctx) {
    const body = await readJson(req);
    const g = await fromCatalog(() => catalog.game(ctx.params.id));
    const project = await targetProject(body.projectId);
    const platform = body.platform === "PS4" ? "PS4" : "PS5";
    const style = STYLES.has(body.style) ? body.style : "standard";

    let front = null;
    if (body.artId) {
      const art = await fromCatalog(() => catalog.art(g.meta.id));
      const item = art.items.find((i) => i.id === body.artId);
      if (!item) throw new HttpError(400, "That art is not one of this game's candidates.");
      front = { url: item.url, source: item.source, kind: item.kind, width: item.width, height: item.height, fit: item.fit, applied: false };
    }
    const copy = body.copy ? cleanCopy(body.copy) : await catalog.cachedCopy(g.meta.id);

    // One cover per game + platform across the account; another run is a new version of it.
    const existing = repo.coverForRawg(db, account().id, g.meta.id, platform);
    let cover;
    if (existing) {
      // Same game, same shelf: re-run it with the new choices. Quota was charged at ingest.
      cover = repo.getCover(db, account().id, existing.id);
    } else {
      if (coverRoom() < 1) {
        const plan = auth.planOf(account());
        throw new HttpError(402, `The ${plan.label} plan includes ${plan.coversPerMonth} covers a month and they are used. Re-running existing covers is still free.`);
      }
      cover = repo.createCover(db, account().id, project.id, { title: g.meta.name, platform, mode: "auto" });
      auth.recordUsage(db, account().id, "cover.created", cover.id);
      repo.setCoverMeta(db, cover.id, { meta: { ...g.meta, query: g.meta.name } });
    }
    const source = repo.coverSource(cover);
    repo.setCoverSource(db, cover.id, { ...source, rawgId: g.meta.id, ...(front ? { front } : {}) });
    if (copy) repo.setCoverMeta(db, cover.id, { copy: { tagline: copy.tagline, blurb: copy.blurb, features: copy.features } });
    repo.setCoverOverrides(db, cover.id, keptOverrides({ ...repo.coverOverrides(cover), style }));
    const jobId = enqueueBuild(db, account().id, cover.id);

    const fresh = repo.listAccountCovers(db, account().id, { projectId: cover.project_id }).find((c) => c.id === cover.id);
    return sendJson(res, existing ? 200 : 201, {
      cover: coverDto(fresh),
      created: !existing,
      jobId,
      runUrl: `/api/covers/${cover.id}/run`,
      usage: usage(),
    });
  }

  /** Library multi-select: one cover per game, each built with the best-fit art. */
  async function batchCovers(req, res) {
    const body = await readJson(req);
    const games = Array.isArray(body.games) ? body.games.slice(0, 50) : [];
    if (!games.length) throw new HttpError(400, "Pick at least one game.");
    const project = await targetProject(body.projectId);
    let room = coverRoom();
    const created = [];
    const rerun = [];
    let skipped = 0;
    for (const item of games) {
      const rawgId = Number(item?.rawgId);
      const name = String(item?.name || "").trim().slice(0, 160);
      if (!Number.isInteger(rawgId) || rawgId <= 0 || !name) continue;
      const platform = item.platform === "PS4" ? "PS4" : "PS5";
      const existing = repo.coverForRawg(db, account().id, rawgId, platform);
      if (existing) {
        // Already a cover: generating it again means a new variant, not a duplicate.
        enqueueBuild(db, account().id, existing.id, "variant");
        rerun.push(existing.id);
        continue;
      }
      if (room < 1) {
        skipped++;
        continue;
      }
      const cover = repo.createCover(db, account().id, project.id, { title: name, platform, mode: "auto" });
      auth.recordUsage(db, account().id, "cover.created", cover.id);
      repo.setCoverSource(db, cover.id, { rawgId });
      enqueueBuild(db, account().id, cover.id);
      room--;
      created.push(cover.id);
    }
    const plan = auth.planOf(account());
    return sendJson(res, 201, {
      projectId: project.id,
      created,
      rerun,
      skipped,
      usage: usage(),
      message:
        `${created.length} cover${created.length === 1 ? "" : "s"} queued` +
        (rerun.length ? `, ${rerun.length} re-run` : "") +
        (skipped ? `, ${skipped} held back by the ${plan.coversPerMonth}-cover limit` : ""),
    });
  }

  async function listCovers(req, res, ctx) {
    const projectId = ctx.query.get("projectId") || null;
    if (projectId) await projectOr404(projectId);
    const byCover = new Map();
    for (const r of repo.accountVersions(db, account().id)) {
      if (!byCover.has(r.cover_id)) byCover.set(r.cover_id, []);
      byCover.get(r.cover_id).push(r);
    }
    const covers = repo.listAccountCovers(db, account().id, { projectId }).map((c) => ({
      ...coverDto(c),
      versions: (byCover.get(c.id) || []).map((r) => versionDto(r, c)),
    }));
    return sendJson(res, 200, { covers, pending: pendingJobs(db, account().id) });
  }

  async function getCoverRun(req, res, ctx) {
    const cover = await coverOr404(ctx.params.id);
    const row = repo.listAccountCovers(db, account().id, { projectId: cover.project_id }).find((c) => c.id === cover.id);
    const render = repo.latestRender(db, cover.id);
    return sendJson(res, 200, {
      cover: coverDto(row),
      run: jobRunDto(latestJobForCover(db, cover.id)),
      steps: PIPELINE_STEPS,
      qc: render ? parse(render.qc) : null,
      render: render
        ? { id: render.id, version: render.version, wrapUrl: `/api/renders/${render.id}/wrap.png`, frontUrl: `/api/renders/${render.id}/front.png` }
        : null,
      print: { trimMm: { ...TRIM }, bleedMm: bleed, dpi: 300 },
    });
  }

  async function listRuns(req, res, ctx) {
    const runs = repo.recentRuns(db, account().id, ctx.query.get("limit")).map((j) => {
      const dto = jobRunDto(j);
      return {
        id: dto.id,
        coverId: j.cover_id,
        projectId: j.project_id,
        title: j.title,
        platform: j.platform,
        coverStatus: j.cover_status,
        state: dto.state,
        step: dto.step,
        totalSteps: dto.totalSteps,
        currentLabel: dto.steps.find((s) => s.state === "running")?.label || null,
        lastError: dto.lastError,
        createdAt: dto.createdAt,
        finishedAt: dto.finishedAt,
      };
    });
    return sendJson(res, 200, { active: activeJobs(db, account().id).length, runs });
  }

  /* --------------------------------------------------------- AI art (Gemini) */

  const fromGemini = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GeminiError) throw new HttpError(err.status || 502, err.message);
      throw err;
    }
  };

  /** The front-art prompt for a game: the saved edit, else llama3.2's draft (or a RAWG-built fallback). */
  async function getAiPrompt(req, res, ctx) {
    const g = await fromCatalog(() => catalog.game(ctx.params.id));
    const p = await generator.prompt(g.meta.id, g.meta, { refresh: ctx.query.get("refresh") === "1" });
    return sendJson(res, 200, { ...p, enabled: generator.enabled(), model: generator.model(), maxPerPress: MAX_PER_PRESS });
  }

  /** "Generate art": `count` images (default 2) from the (edited) prompt. */
  async function postAiArt(req, res, ctx) {
    const body = await readJson(req);
    const g = await fromCatalog(() => catalog.game(ctx.params.id));
    const prompt = String(body.prompt || "").trim().slice(0, 2000);
    const out = await fromGemini(() => generator.generate(g.meta.id, g.meta, { prompt, count: body.count ?? 2 }));
    return sendJson(res, 201, out);
  }

  async function getGenerated(req, res, ctx) {
    const file = generator.fileFor(ctx.params.id, ctx.params.file);
    if (!file) throw new HttpError(404, "Unknown generated image.");
    const ok = await serveFile(res, file);
    if (!ok) throw new HttpError(404, "Generated image is missing.");
  }

  /** Settings → Pipeline. The only writable setting; keys stay in .env. */
  async function putPipelineSettings(req, res) {
    const body = await readJson(req);
    if (typeof body.aiArt !== "boolean") throw new HttpError(400, "aiArt must be true or false.");
    repo.setSettings(db, account().id, { aiArtStep: String(body.aiArt) });
    return sendJson(res, 200, { pipeline: { aiArt: aiStepOn() }, gemini: { configured: generator.enabled(), model: generator.model() } });
  }

  /* ------------------------------------------------------------ routing */

  const ROUTES = [
    ["GET", /^\/$/, root],
    ["GET", /^\/api\/health$/, health],
    ["GET", /^\/api\/me$/, me],
    ["GET", /^\/api\/legal$/, legal],
    ["GET", /^\/api\/projects$/, listProjects],
    ["POST", /^\/api\/projects$/, createProject],
    ["GET", /^\/api\/projects\/([^/]+)$/, getProject],
    ["PATCH", /^\/api\/projects\/([^/]+)$/, patchProject],
    ["POST", /^\/api\/projects\/([^/]+)\/import$/, importTitles],
    ["POST", /^\/api\/projects\/([^/]+)\/build$/, buildProject],
    ["GET", /^\/api\/projects\/([^/]+)\/status$/, projectStatus],
    ["GET", /^\/api\/projects\/([^/]+)\/print$/, printPlan],
    ["GET", /^\/api\/covers\/([^/]+)$/, getCover],
    ["PATCH", /^\/api\/covers\/([^/]+)$/, patchCover],
    ["POST", /^\/api\/covers\/([^/]+)\/build$/, buildCoverRoute],
    ["POST", /^\/api\/covers\/([^/]+)\/render$/, rerenderCover],
    ["POST", /^\/api\/covers\/([^/]+)\/decision$/, decideCover],
    ["POST", /^\/api\/covers\/([^/]+)\/retry$/, retryCover],
    ["GET", /^\/api\/covers\/([^/]+)\/versions$/, listCoverVersions],
    ["DELETE", /^\/api\/covers\/([^/]+)$/, deleteCover],
    ["POST", /^\/api\/covers\/delete$/, bulkDeleteCovers],
    ["DELETE", /^\/api\/covers\/([^/]+)\/versions\/([^/]+)$/, deleteCoverVersion],
    ["DELETE", /^\/api\/projects\/([^/]+)$/, deleteProjectRoute],
    ["DELETE", /^\/api\/runs$/, clearRunsRoute],
    ["DELETE", /^\/api\/runs\/([^/]+)$/, deleteRunRoute],
    ["DELETE", /^\/api\/generated\/([^/]+)\/([^/]+)$/, deleteGenerated],
    ["DELETE", /^\/api\/games\/([^/]+)\/ai-art$/, clearGenerated],
    ["POST", /^\/api\/reset$/, deleteEverything],
    ["PUT", /^\/api\/covers\/([^/]+)\/art\/([^/]+)$/, uploadArt],
    ["GET", /^\/api\/covers\/([^/]+)\/art\/([^/]+)$/, getArt],
    ["GET", /^\/api\/renders\/([^/]+)\/([^/]+)$/, getRender],
    ["GET", /^\/api\/settings$/, getSettings],
    ["GET", /^\/api\/settings\/llm$/, getLlmSettings],
    ["GET", /^\/api\/settings\/models$/, getLlmModels],
    ["GET", /^\/api\/rawg\/search$/, getRawgSearch],
    ["GET", /^\/api\/games\/([^/]+)$/, getGame],
    ["GET", /^\/api\/games\/([^/]+)\/art$/, getGameArt],
    ["GET", /^\/api\/games\/([^/]+)\/ai-prompt$/, getAiPrompt],
    ["POST", /^\/api\/games\/([^/]+)\/ai-art$/, postAiArt],
    ["GET", /^\/api\/generated\/([^/]+)\/([^/]+)$/, getGenerated],
    ["PUT", /^\/api\/settings\/pipeline$/, putPipelineSettings],
    ["POST", /^\/api\/games\/([^/]+)\/copy$/, draftGameCopy],
    ["POST", /^\/api\/games\/([^/]+)\/covers$/, createGameCover],
    ["GET", /^\/api\/covers$/, listCovers],
    ["POST", /^\/api\/covers\/batch$/, batchCovers],
    ["GET", /^\/api\/covers\/([^/]+)\/run$/, getCoverRun],
    ["GET", /^\/api\/runs$/, listRuns],
  ];

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      return sendError(res, 400, "Bad request.");
    }

    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req, appOrigin)) {
      return sendError(res, 403, "Cross-origin request refused.");
    }

    for (const [method, pattern, handler] of ROUTES) {
      if (req.method !== method) continue;
      const match = pattern.exec(url.pathname);
      if (!match) continue;
      try {
        return await handler(req, res, {
          url,
          query: url.searchParams,
          params: { id: match[1], slot: match[2], file: match[2] },
        });
      } catch (err) {
        if (err instanceof HttpError) return sendError(res, err.status, err.message);
        throw err;
      }
    }

    return sendError(res, 404, `No route for ${req.method} ${url.pathname}`);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error?.(`${req.method} ${req.url}: ${err.stack || err.message}`);
      if (res.headersSent) return res.end();
      return sendError(res, 500, "The request failed.");
    });
  });

  async function start(port = Number(process.env.PORT || 3000), host = process.env.HOST || "127.0.0.1") {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    worker.start();
    const address = server.address();
    return { port: address.port, host, url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${address.port}` };
  }

  async function close() {
    worker.stop();
    await new Promise((resolve) => server.close(resolve));
    if (ownsDb) db.close();
  }

  return { db, dataDir, account: account(), server, worker, start, close, secret, appOrigin };
}

/** Only the override keys the renderer reads ever reach the database. */
function keptOverrides(raw) {
  const allowed = {};
  for (const key of ["title", "titleSize", "titleAnchor", "titleAlign", "zoom", "offX", "offY", "ribbon", "subtitle", "style", "accent"]) {
    if (raw && raw[key] !== undefined) allowed[key] = raw[key];
  }
  return allowed;
}

/** Back-cover copy from a client or a model: three known fields, bounded lengths. */
function cleanCopy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const features = (Array.isArray(raw.features) ? raw.features : String(raw.features || "").split("\n"))
    .map((f) => str(f, 60))
    .filter(Boolean)
    .slice(0, 4);
  const copy = { tagline: str(raw.tagline, 80), blurb: str(raw.blurb, 1200), features };
  return copy.blurb || copy.tagline || features.length ? copy : null;
}

/* ------------------------------------------------------------- direct run */

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const instance = createApp();
  const { url } = await instance.start();
  console.log(`Coverpress API on ${url}  (local mode, no auth — data: ${instance.dataDir})`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await instance.close();
      process.exit(0);
    });
  }
}

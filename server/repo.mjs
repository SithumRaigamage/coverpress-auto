/* Tenant-scoped data access.

   Every read and write takes an accountId and joins through projects, so a
   guessed project/cover/render id from another account returns null instead of
   data. Never add a query here that looks a cover up by id alone. */

import crypto from "node:crypto";
import { nowIso } from "./db.mjs";

const j = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

export const COVER_STATUSES = [
  "queued",
  "processing",
  "auto_approved",
  "needs_review",
  "failed",
  "approved",
  "rejected",
];

/* -------------------------------------------------------------- projects */

export function createProject(db, accountId, { name, platform = "PS5", layout = "auto" }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO projects (id, account_id, name, platform, layout, accent, mark, address, edition, created_at)
     VALUES (?, ?, ?, ?, ?, '', '', '', '', ?)`
  ).run(id, accountId, String(name).trim().slice(0, 120) || "Untitled project", platform === "PS4" ? "PS4" : "PS5", layout, nowIso());
  return getProject(db, accountId, id);
}

export function getProject(db, accountId, projectId) {
  return db
    .prepare("SELECT * FROM projects WHERE id = ? AND account_id = ?")
    .get(projectId, accountId) || null;
}

export function listProjects(db, accountId) {
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM covers c WHERE c.project_id = p.id) AS cover_count,
              (SELECT COUNT(*) FROM covers c WHERE c.project_id = p.id AND c.status IN ('auto_approved','approved')) AS ready_count
       FROM projects p WHERE p.account_id = ? ORDER BY p.created_at DESC`
    )
    .all(accountId);
}

export function updateProjectTheme(db, accountId, projectId, theme = {}) {
  const project = getProject(db, accountId, projectId);
  if (!project) return null;
  const pick = (k, max) =>
    theme[k] === undefined ? project[k] : String(theme[k]).slice(0, max);
  db.prepare("UPDATE projects SET layout = ?, accent = ?, mark = ?, address = ?, edition = ?, platform = ? WHERE id = ? AND account_id = ?").run(
    ["auto", "ps4", "ps5"].includes(theme.layout) ? theme.layout : project.layout,
    pick("accent", 32),
    pick("mark", 24),
    pick("address", 200),
    pick("edition", 60),
    theme.platform === "PS4" || theme.platform === "PS5" ? theme.platform : project.platform,
    projectId,
    accountId
  );
  return getProject(db, accountId, projectId);
}

/* -------------------------------------------------------------- settings */

/** Non-secret preferences, scoped to the account. Never store secrets here. */
export function getSettings(db, accountId) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE account_id = ?").all(accountId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** `patch` is expected to be whitelisted by server/llm.mjs before it gets here. */
export function setSettings(db, accountId, patch = {}) {
  const entries = Object.entries(patch).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9]{0,49}$/.test(key));
  if (!entries.length) return getSettings(db, accountId);
  const write = db.prepare(
    `INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of entries) write.run(accountId, key, String(value).slice(0, 200));
  return getSettings(db, accountId);
}

/* ---------------------------------------------------------------- covers */

export function createCover(db, accountId, projectId, { title, platform, mode = "manual" }) {
  const project = getProject(db, accountId, projectId);
  if (!project) return null;
  const id = crypto.randomUUID();
  const clean = String(title || "").trim().slice(0, 160);
  if (!clean) throw new Error("Cover title is required.");
  db.prepare(
    `INSERT INTO covers (id, project_id, title, query, platform, mode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
  ).run(id, projectId, clean, clean, platform === "PS4" ? "PS4" : "PS5", mode === "auto" ? "auto" : "manual", nowIso(), nowIso());
  return getCover(db, accountId, id);
}

export function getCover(db, accountId, coverId) {
  return db
    .prepare(
      `SELECT c.*, p.account_id, p.name AS project_name, p.layout, p.accent, p.mark, p.address, p.edition,
              p.platform AS project_platform
       FROM covers c JOIN projects p ON p.id = c.project_id
       WHERE c.id = ? AND p.account_id = ?`
    )
    .get(coverId, accountId) || null;
}

export function listCovers(db, accountId, projectId) {
  return db
    .prepare(
      `SELECT c.*, p.account_id FROM covers c JOIN projects p ON p.id = c.project_id
       WHERE c.project_id = ? AND p.account_id = ? ORDER BY c.created_at, c.rowid`
    )
    .all(projectId, accountId);
}

export function listCoversWithRender(db, accountId, projectId) {
  return db
    .prepare(
      `SELECT c.*, p.account_id,
              r.id AS render_id, r.version AS render_version,
              (SELECT path FROM art WHERE cover_id = c.id AND slot = 'front') AS art_path
       FROM covers c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN renders r ON r.id = (
         SELECT id FROM renders WHERE cover_id = c.id ORDER BY version DESC LIMIT 1
       )
       WHERE c.project_id = ? AND p.account_id = ?
       ORDER BY c.created_at, c.rowid`
    )
    .all(projectId, accountId);
}

export function coversForBuild(db, accountId, projectId) {
  return db
    .prepare(
      `SELECT c.id FROM covers c JOIN projects p ON p.id = c.project_id
       WHERE c.project_id = ? AND p.account_id = ? AND c.status IN ('queued','failed','needs_review','auto_approved')
       ORDER BY c.created_at`
    )
    .all(projectId, accountId);
}

export function setCoverStatus(db, coverId, status, { error = "", qc = null } = {}) {
  if (!COVER_STATUSES.includes(status)) throw new Error(`Unknown status ${status}`);
  db.prepare("UPDATE covers SET status = ?, error = ?, qc = COALESCE(?, qc), updated_at = ? WHERE id = ?").run(
    status,
    error,
    qc ? JSON.stringify(qc) : null,
    nowIso(),
    coverId
  );
}

export function setCoverMeta(db, coverId, { meta, copy }) {
  const fields = [];
  const values = [];
  if (meta !== undefined) {
    fields.push("meta = ?");
    values.push(meta ? JSON.stringify(meta) : "");
  }
  if (copy !== undefined) {
    fields.push("copy = ?");
    values.push(copy ? JSON.stringify(copy) : "");
  }
  if (!fields.length) return;
  values.push(nowIso(), coverId);
  db.prepare(`UPDATE covers SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
}

export function setCoverOverrides(db, coverId, overrides) {
  db.prepare("UPDATE covers SET overrides = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(overrides || {}),
    nowIso(),
    coverId
  );
}

/** Approve (a specific version, or the latest) or reject. */
export function setCoverDecision(db, accountId, coverId, decision, renderId = "") {
  const cover = getCover(db, accountId, coverId);
  if (!cover) return null;
  if (decision !== "approved" && decision !== "rejected") throw new Error("Unknown decision.");
  db.prepare("UPDATE covers SET status = ?, decided_at = ?, approved_render_id = ?, updated_at = ? WHERE id = ?").run(
    decision,
    nowIso(),
    decision === "approved" ? renderId || "" : "",
    nowIso(),
    coverId
  );
  return getCover(db, accountId, coverId);
}

export const coverMeta = (cover) => j(cover.meta, null);
export const coverCopy = (cover) => j(cover.copy, null);
export const coverOverrides = (cover) => j(cover.overrides, {});
export const coverQc = (cover) => j(cover.qc, null);

/* ------------------------------------------------------------------- art */

export function setArt(db, coverId, slot, file, { width = 0, height = 0, bytes = 0, kind = "upload" } = {}) {
  db.prepare(
    `INSERT INTO art (cover_id, slot, path, width, height, bytes, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (cover_id, slot) DO UPDATE SET
       path = excluded.path, width = excluded.width, height = excluded.height,
       bytes = excluded.bytes, kind = excluded.kind, created_at = excluded.created_at`
  ).run(coverId, slot, file, width, height, bytes, kind, nowIso());
}

export function listArt(db, coverId) {
  return db.prepare("SELECT * FROM art WHERE cover_id = ? ORDER BY slot").all(coverId);
}

export function artFor(db, coverId, slot) {
  return db.prepare("SELECT * FROM art WHERE cover_id = ? AND slot = ?").get(coverId, slot) || null;
}

/** The shape lib/cover.mjs wants: absolute paths per template slot. */
export function artPaths(db, coverId) {
  const rows = listArt(db, coverId);
  const out = { front: null, back: null, shots: [] };
  const shots = [];
  for (const row of rows) {
    if (row.slot === "front") out.front = row.path;
    else if (row.slot === "back") out.back = row.path;
    else if (/^shot\d$/.test(row.slot)) shots[Number(row.slot.slice(4))] = row.path;
  }
  out.shots = shots.filter(Boolean);
  return out;
}

export const ART_SLOTS = new Set(["front", "back", "shot0", "shot1", "shot2"]);

/* --------------------------------------------------------------- renders */

export function nextRenderVersion(db, coverId) {
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM renders WHERE cover_id = ?").get(coverId);
  return Number(row.v) + 1;
}

export function addRender(db, coverId, { id = crypto.randomUUID(), wrapPath, frontPath, qc, cfg, meta = {} }) {
  const version = nextRenderVersion(db, coverId);
  db.prepare(
    "INSERT INTO renders (id, cover_id, version, wrap_path, front_path, qc, cfg, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, coverId, version, wrapPath, frontPath, JSON.stringify(qc || {}), JSON.stringify(cfg || {}), JSON.stringify(meta || {}), nowIso());
  return { id, version };
}

/** Every version of a cover, newest first, scoped through projects.account_id. */
export function listVersions(db, accountId, coverId) {
  return db
    .prepare(
      `SELECT r.id, r.version, r.qc, r.meta, r.created_at
       FROM renders r JOIN covers c ON c.id = r.cover_id JOIN projects p ON p.id = c.project_id
       WHERE r.cover_id = ? AND p.account_id = ?
       ORDER BY r.version DESC`
    )
    .all(coverId, accountId);
}

/** Version summaries for every cover of an account (the review board), one query. */
export function accountVersions(db, accountId) {
  return db
    .prepare(
      `SELECT r.id, r.cover_id, r.version, r.qc, r.meta, r.created_at
       FROM renders r JOIN covers c ON c.id = r.cover_id JOIN projects p ON p.id = c.project_id
       WHERE p.account_id = ?
       ORDER BY r.cover_id, r.version DESC`
    )
    .all(accountId);
}

/** Point a cover at the version a reviewer approved ('' clears it). */
export function setApprovedRender(db, coverId, renderId) {
  db.prepare("UPDATE covers SET approved_render_id = ?, updated_at = ? WHERE id = ?").run(renderId || "", nowIso(), coverId);
}

export function latestRender(db, coverId) {
  return db.prepare("SELECT * FROM renders WHERE cover_id = ? ORDER BY version DESC LIMIT 1").get(coverId) || null;
}

export function getRender(db, accountId, renderId) {
  return db
    .prepare(
      `SELECT r.*, c.title, c.platform, c.status AS cover_status
       FROM renders r
       JOIN covers c ON c.id = r.cover_id
       JOIN projects p ON p.id = c.project_id
       WHERE r.id = ? AND p.account_id = ?`
    )
    .get(renderId, accountId) || null;
}

export function approvedRenders(db, accountId, projectId) {
  return db
    .prepare(
      `SELECT c.id AS cover_id, c.title, c.platform, c.status, r.id AS render_id, r.version
       FROM covers c
       JOIN projects p ON p.id = c.project_id
       JOIN renders r ON r.id = COALESCE(
         NULLIF(c.approved_render_id, ''),
         (SELECT id FROM renders WHERE cover_id = c.id ORDER BY version DESC LIMIT 1)
       )
       WHERE p.account_id = ? AND p.id = ?
         AND c.status IN ('approved','auto_approved')
       ORDER BY c.created_at`
    )
    .all(accountId, projectId);
}

/* ---------------------------------------------------------------- counts */

/** Up to N latest-render ids per project, for the shelf mosaics on the dashboard. */
export function projectMosaics(db, accountId, perProject = 3) {
  const rows = db
    .prepare(
      `SELECT p.id AS project_id, r.id AS render_id,
              ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY c.created_at) AS rn
       FROM projects p
       JOIN covers c ON c.project_id = p.id
       LEFT JOIN renders r ON r.id = (
         SELECT id FROM renders WHERE cover_id = c.id ORDER BY version DESC LIMIT 1
       )
       WHERE p.account_id = ?`
    )
    .all(accountId);
  const out = {};
  for (const row of rows) {
    if (Number(row.rn) > perProject || !row.render_id) continue;
    (out[row.project_id] = out[row.project_id] || []).push(row.render_id);
  }
  return out;
}

export function projectSummary(db, accountId, projectId) {
  const rows = db
    .prepare(
      `SELECT c.status, COUNT(*) AS n FROM covers c JOIN projects p ON p.id = c.project_id
       WHERE p.account_id = ? AND c.project_id = ? GROUP BY c.status`
    )
    .all(accountId, projectId);
  const counts = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

/* ------------------------------------------------- library and runs */

/** Where a cover came from and which art was picked. JSON in covers.source. */
export const coverSource = (cover) => j(cover.source, {});

export function setCoverSource(db, coverId, source) {
  db.prepare("UPDATE covers SET source = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(source || {}),
    nowIso(),
    coverId
  );
}

/** Every cover the account owns, optionally one project, newest first. */
export function listAccountCovers(db, accountId, { projectId = null } = {}) {
  return db
    .prepare(
      `SELECT c.*, p.account_id, p.name AS project_name,
              r.id AS render_id, r.version AS render_version,
              (SELECT path FROM art WHERE cover_id = c.id AND slot = 'front') AS art_path
       FROM covers c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN renders r ON r.id = (
         SELECT id FROM renders WHERE cover_id = c.id ORDER BY version DESC LIMIT 1
       )
       WHERE p.account_id = ? AND (? IS NULL OR p.id = ?)
       ORDER BY c.updated_at DESC, c.rowid DESC`
    )
    .all(accountId, projectId, projectId);
}

/** The account's cover for this RAWG game on this platform, if any. One game +
 *  platform is one cover; further runs are versions of it, not new covers. */
export function coverForRawg(db, accountId, rawgId, platform) {
  return (
    db
      .prepare(
        `SELECT c.id, c.project_id FROM covers c JOIN projects p ON p.id = c.project_id
         WHERE p.account_id = ? AND c.platform = ?
           AND ((json_valid(c.source) AND json_extract(c.source, '$.rawgId') = ?)
             OR (json_valid(c.meta) AND json_extract(c.meta, '$.id') = ?))
         ORDER BY c.created_at LIMIT 1`
      )
      .get(accountId, platform === "PS4" ? "PS4" : "PS5", Number(rawgId), Number(rawgId)) || null
  );
}

/** A title-only cover (pasted list) with the same normalised title and platform. */
export function coverForTitle(db, accountId, title, platform) {
  const key = normTitle(title);
  return (
    db
      .prepare(
        `SELECT c.id, c.title FROM covers c JOIN projects p ON p.id = c.project_id
         WHERE p.account_id = ? AND c.platform = ?`
      )
      .all(accountId, platform === "PS4" ? "PS4" : "PS5")
      .find((c) => normTitle(c.title) === key) || null
  );
}

/** Title identity for de-duplication: case, punctuation and edition noise ignored. */
export const normTitle = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")
    .replace(/\b(standard|deluxe|ultimate|remastered|remake|collection|edition)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Recent jobs with their cover, scoped through projects.account_id. */
export function recentRuns(db, accountId, limit = 30) {
  return db
    .prepare(
      `SELECT j.*, c.title, c.platform, c.status AS cover_status, c.project_id
       FROM jobs j
       JOIN covers c ON c.id = j.cover_id
       JOIN projects p ON p.id = c.project_id
       WHERE p.account_id = ?
       ORDER BY j.created_at DESC, j.rowid DESC
       LIMIT ?`
    )
    .all(accountId, Math.max(1, Math.min(100, Number(limit) || 30)));
}

export function deleteArt(db, coverId, slot) {
  db.prepare("DELETE FROM art WHERE cover_id = ? AND slot = ?").run(coverId, slot);
}

export function setCoverPlatform(db, coverId, platform) {
  db.prepare("UPDATE covers SET platform = ?, updated_at = ? WHERE id = ?").run(
    platform === "PS4" ? "PS4" : "PS5",
    nowIso(),
    coverId
  );
}

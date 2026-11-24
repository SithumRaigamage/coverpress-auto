/* Deleting things: covers, single versions, runs, shelves, AI drafts, everything.

   Rows go first. Foreign keys cascade a cover's renders, art and jobs, and a
   shelf's covers. Files follow, best effort: a missing file is not an error.

   A cover whose build is running right now is never deleted. The worker would
   finish, find the row gone and leave its render files orphaned on disk. The
   caller gets a 409 (single delete) or a "skipped" entry (bulk delete) instead;
   queued builds are fine, because their job row disappears with the cover. */

import fs from "node:fs/promises";
import { nowIso } from "./db.mjs";
import { safeJoin } from "./http.mjs";

export class PurgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_BULK = 500;

async function rm(dataDir, rel) {
  const file = rel && safeJoin(dataDir, rel);
  if (file) await fs.rm(file, { recursive: true, force: true }).catch(() => {});
}

/** The account's cover rows for these ids, with whether a build is running. */
function ownedCovers(db, accountId, ids) {
  const wanted = [...new Set(ids.map(String).filter((id) => ID.test(id)))].slice(0, MAX_BULK);
  if (!wanted.length) return [];
  const marks = wanted.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT c.*, EXISTS (SELECT 1 FROM jobs j WHERE j.cover_id = c.id AND j.state = 'running') AS running
       FROM covers c JOIN projects p ON p.id = c.project_id
       WHERE p.account_id = ? AND c.id IN (${marks})`
    )
    .all(accountId, ...wanted);
}

/** Folders and files that belong to these covers: render folders and the art folder. */
function filesFor(db, accountId, coverIds) {
  const out = [];
  for (const id of coverIds) {
    for (const r of db.prepare("SELECT id FROM renders WHERE cover_id = ?").all(id)) {
      if (ID.test(r.id)) out.push(`renders/${r.id}`);
    }
    for (const a of db.prepare("SELECT path FROM art WHERE cover_id = ?").all(id)) {
      // Shared folders are never a cover's to delete, whatever a row says.
      if (!/^art\/(generated|cache)\//.test(a.path)) out.push(a.path);
    }
    if (ID.test(String(accountId)) && ID.test(id)) out.push(`art/${accountId}/${id}`);
  }
  return out;
}

async function removeCovers(db, dataDir, accountId, rows) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const files = filesFor(db, accountId, ids);
  const del = db.prepare("DELETE FROM covers WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const id of ids) del.run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  for (const rel of files) await rm(dataDir, rel);
  return ids;
}

/** One cover. 404 when it isn't the account's, 409 while its build runs. */
export async function deleteCover(db, dataDir, accountId, coverId) {
  const [row] = ownedCovers(db, accountId, [coverId]);
  if (!row) throw new PurgeError(404, "Cover not found.");
  if (row.running) throw new PurgeError(409, "This cover is building right now. Delete it when the run finishes.");
  await removeCovers(db, dataDir, accountId, [row]);
  return { deleted: row.id, projectId: row.project_id };
}

/** Many covers at once (a review column). Running builds are skipped, not failed. */
export async function deleteCovers(db, dataDir, accountId, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new PurgeError(400, "Send ids: a non-empty list of cover ids.");
  if (ids.length > MAX_BULK) throw new PurgeError(400, `At most ${MAX_BULK} covers per request.`);
  const rows = ownedCovers(db, accountId, ids);
  const skipped = rows.filter((r) => r.running).map((r) => ({ id: r.id, reason: "building" }));
  const deleted = await removeCovers(db, dataDir, accountId, rows.filter((r) => !r.running));
  const known = new Set(rows.map((r) => r.id));
  for (const id of new Set(ids.map(String))) if (!known.has(id)) skipped.push({ id, reason: "not_found" });
  return { deleted, skipped };
}

/** The status a cover should show once its latest render is whatever is left. */
function statusFromRender(render) {
  try {
    const s = JSON.parse(render?.qc || "null")?.status;
    if (["auto_approved", "needs_review", "failed"].includes(s)) return s;
  } catch {
    /* fall through */
  }
  return "needs_review";
}

/**
 * One version (render) of a cover. The last version can't go: delete the cover
 * instead. Deleting the approved version clears the approval and sends the cover
 * back to review, so nothing prints that nobody approved.
 */
export async function deleteVersion(db, dataDir, accountId, coverId, renderId) {
  const [cover] = ownedCovers(db, accountId, [coverId]);
  if (!cover) throw new PurgeError(404, "Cover not found.");
  if (cover.running || ["queued", "processing"].includes(cover.status)) {
    throw new PurgeError(409, "This cover is building. Delete versions when the run finishes.");
  }
  const renders = db.prepare("SELECT * FROM renders WHERE cover_id = ? ORDER BY version DESC").all(coverId);
  const target = renders.find((r) => r.id === renderId);
  if (!target) throw new PurgeError(404, "Version not found.");
  if (renders.length === 1) throw new PurgeError(409, "This is the only version. Delete the whole cover instead.");

  const remaining = renders.filter((r) => r.id !== renderId);
  const latest = remaining[0];
  const wasLatest = renders[0].id === renderId;
  const approvedThis =
    cover.status === "approved" && (cover.approved_render_id === renderId || (!cover.approved_render_id && wasLatest));

  let status = cover.status;
  let approvedRenderId = cover.approved_render_id === renderId ? "" : cover.approved_render_id;
  let decidedAt = cover.decided_at;
  if (approvedThis) {
    status = "needs_review";
    approvedRenderId = "";
    decidedAt = "";
  } else if (wasLatest && ["auto_approved", "needs_review", "failed"].includes(cover.status)) {
    status = statusFromRender(latest);
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM renders WHERE id = ?").run(renderId);
    db.prepare(
      "UPDATE covers SET status = ?, approved_render_id = ?, decided_at = ?, qc = ?, updated_at = ? WHERE id = ?"
    ).run(status, approvedRenderId, decidedAt, wasLatest ? latest.qc : cover.qc, nowIso(), coverId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  if (ID.test(renderId)) await rm(dataDir, `renders/${renderId}`);
  return { deleted: renderId, coverId, status, approvalCleared: approvedThis, versions: remaining.length };
}

function ownedJob(db, accountId, jobId) {
  return db
    .prepare(
      `SELECT j.*, c.status AS cover_status FROM jobs j
       JOIN covers c ON c.id = j.cover_id JOIN projects p ON p.id = c.project_id
       WHERE j.id = ? AND p.account_id = ?`
    )
    .get(String(jobId), accountId);
}

/**
 * One run from the history. A queued run is cancelled: its cover goes back to
 * what its latest render says (or "failed" if it never rendered). A running run
 * can't be deleted.
 */
export function deleteRun(db, accountId, jobId) {
  const job = ownedJob(db, accountId, jobId);
  if (!job) throw new PurgeError(404, "Run not found.");
  if (job.state === "running") throw new PurgeError(409, "This run is in progress. Delete it when it finishes.");

  const cancelled = job.state === "queued";
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
    if (cancelled) {
      const stillActive = db
        .prepare("SELECT 1 FROM jobs WHERE cover_id = ? AND state IN ('queued','running') LIMIT 1")
        .get(job.cover_id);
      if (!stillActive && ["queued", "processing"].includes(job.cover_status)) {
        const latest = db.prepare("SELECT * FROM renders WHERE cover_id = ? ORDER BY version DESC LIMIT 1").get(job.cover_id);
        if (latest) {
          db.prepare("UPDATE covers SET status = ?, error = '', updated_at = ? WHERE id = ?").run(statusFromRender(latest), nowIso(), job.cover_id);
        } else {
          db.prepare("UPDATE covers SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(
            "Run cancelled before it rendered. Retry all steps to build it.",
            nowIso(),
            job.cover_id
          );
        }
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { deleted: job.id, coverId: job.cover_id, cancelled };
}

/** Clear finished runs (done and failed) from the history. Active runs stay. */
export function clearRuns(db, accountId) {
  const res = db.prepare("DELETE FROM jobs WHERE account_id = ? AND state IN ('done','failed')").run(accountId);
  return { deleted: Number(res.changes || 0) };
}

/** A shelf and every cover on it. Refused while any of its covers is building. */
export async function deleteProject(db, dataDir, accountId, projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND account_id = ?").get(String(projectId), accountId);
  if (!project) throw new PurgeError(404, "Shelf not found.");
  const ids = db.prepare("SELECT id FROM covers WHERE project_id = ?").all(project.id).map((r) => r.id);
  const rows = ownedCovers(db, accountId, ids);
  if (rows.some((r) => r.running)) throw new PurgeError(409, "A cover on this shelf is building. Delete the shelf when the run finishes.");
  const files = filesFor(db, accountId, ids);
  db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
  for (const rel of files) await rm(dataDir, rel);
  return { deleted: project.id, covers: ids.length };
}

/**
 * Everything the user made: every shelf, cover, version and run, and (when asked)
 * every AI-generated image. Settings, the RAWG cache and usage counters stay:
 * the cache saves quota and the counters track real API calls.
 */
export async function deleteEverything(db, dataDir, accountId, { aiArt = false } = {}) {
  const running = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE account_id = ? AND state = 'running'").get(accountId);
  if (Number(running.n)) throw new PurgeError(409, "A build is running. Wait for it to finish, then delete everything.");
  const projects = db.prepare("SELECT id FROM projects WHERE account_id = ?").all(accountId);
  const ids = db
    .prepare("SELECT c.id FROM covers c JOIN projects p ON p.id = c.project_id WHERE p.account_id = ?")
    .all(accountId)
    .map((r) => r.id);
  const files = filesFor(db, accountId, ids);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM projects WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM jobs WHERE account_id = ?").run(accountId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  for (const rel of files) await rm(dataDir, rel);
  if (aiArt) await rm(dataDir, "art/generated");
  return { shelves: projects.length, covers: ids.length, aiArt: Boolean(aiArt) };
}

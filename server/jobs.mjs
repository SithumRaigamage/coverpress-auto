/* Durable job queue.

   Jobs live in SQLite, so a restart does not lose work. One in-process worker
   claims a job at a time: covers are CPU-bound (canvas render) and this keeps
   memory flat on a small box. Claiming is a compare-and-swap UPDATE so a second
   worker process can be added later without corrupting state.

   The handler owns the cover's status; the worker owns the job row and decides
   whether an error is worth retrying. */

import crypto from "node:crypto";
import { nowIso } from "./db.mjs";

const BACKOFF = [0, 2000, 8000];

export function enqueueBuild(db, accountId, coverId) {
  const existing = db
    .prepare("SELECT id FROM jobs WHERE cover_id = ? AND state IN ('queued','running')")
    .get(coverId);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, account_id, kind, cover_id, state, attempts, max_attempts, run_after, created_at, updated_at)
     VALUES (?, ?, 'build', ?, 'queued', 0, 3, ?, ?, ?)`
  ).run(id, accountId, coverId, now, now, now);

  // A hand approval is a decision, not a build state. Leaving it in place is
  // what lets the build recognise and restore it afterwards.
  const current = db.prepare("SELECT status FROM covers WHERE id = ?").get(coverId);
  if (!current || (current.status !== "approved" && current.status !== "rejected")) {
    db.prepare("UPDATE covers SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, coverId);
  } else {
    db.prepare("UPDATE covers SET error = '', updated_at = ? WHERE id = ?").run(now, coverId);
  }
  return id;
}

export function claimJob(db) {
  const now = nowIso();
  const row = db
    .prepare(
      `SELECT * FROM jobs WHERE state = 'queued' AND run_after <= ?
       ORDER BY created_at, rowid LIMIT 1`
    )
    .get(now);
  if (!row) return null;
  const res = db
    .prepare("UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'queued'")
    .run(now, row.id);
  if (res.changes !== 1) return null;
  return { ...row, attempts: row.attempts + 1 };
}

export function pendingJobs(db, accountId = null) {
  const sql = accountId
    ? "SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running') AND account_id = ?"
    : "SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')";
  return Number((accountId ? db.prepare(sql).get(accountId) : db.prepare(sql).get()).n || 0);
}

function complete(db, job) {
  db.prepare("UPDATE jobs SET state = 'done', last_error = '', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
}

function fail(db, job, error) {
  const message = String(error?.message || error).slice(0, 800);
  const permanent = error?.permanent === true || job.attempts >= job.max_attempts;

  if (permanent) {
    db.prepare("UPDATE jobs SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(
      message,
      nowIso(),
      job.id
    );
    return;
  }

  const wait = BACKOFF[Math.min(job.attempts, BACKOFF.length - 1)];
  const runAfter = new Date(Date.now() + wait).toISOString();
  db.prepare("UPDATE jobs SET state = 'queued', run_after = ?, last_error = ?, updated_at = ? WHERE id = ?").run(
    runAfter,
    message,
    nowIso(),
    job.id
  );
  // A retry is in flight, so the cover should not look terminally failed.
  db.prepare("UPDATE covers SET status = 'queued', updated_at = ? WHERE id = ?").run(nowIso(), job.cover_id);
}

/** Mark a job as permanently failed (used when the cover was deleted mid-flight). */
export function abandonJob(db, jobId, message) {
  db.prepare("UPDATE jobs SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(
    String(message).slice(0, 800),
    nowIso(),
    jobId
  );
}

export function createWorker({ db, run, intervalMs = 300, logger = () => {} }) {
  let timer = null;
  let chain = Promise.resolve();
  let stopped = false;

  async function execute(job) {
    try {
      await run(job);
      complete(db, job);
    } catch (error) {
      logger.error(`job ${job.kind}/${job.id} failed: ${error.message}`);
      fail(db, job, error);
    }
  }

  async function runAll() {
    if (stopped) return 0;
    let done = 0;
    for (;;) {
      const job = claimJob(db);
      if (!job) break;
      await execute(job);
      done++;
      if (stopped) break;
    }
    return done;
  }

  /** Await every currently queued job. Used by tests and by `npm run worker`. */
  function drain() {
    chain = chain.then(runAll, runAll);
    return chain;
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => {
      drain().catch((e) => logger.error(`worker: ${e.message}`));
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, drain, get stopped() { return stopped; } };
}

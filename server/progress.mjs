/* Per-job pipeline progress, stored on the job row.

   The build worker reports into a reporter; the run screen reads the result
   through GET /api/covers/:id/run. Writes are synchronous SQLite updates, so a
   poll always sees the step that is actually running — there is no in-memory
   state to lose on restart.

   Seven steps, in the order the build performs them. Keys are stable API data;
   labels are what the run screen prints. */

import { nowIso } from "./db.mjs";

export const PIPELINE_STEPS = [
  { key: "metadata", label: "Fetch metadata" },
  { key: "collect", label: "Collect art" },
  { key: "pick", label: "Pick front art" },
  { key: "copy", label: "Write back-cover copy" },
  { key: "render", label: "Render the wrap" },
  { key: "qc", label: "Quality checks" },
  { key: "route", label: "Route the cover" },
];

const MAX_LOG = 200;

const parse = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

export const freshSteps = () => PIPELINE_STEPS.map((s) => ({ ...s, state: "pending", detail: "" }));

/** A reporter bound to one job row. Every method is safe to call after the job is gone. */
export function progressReporter(db, jobId) {
  const read = () => db.prepare("SELECT progress, log FROM jobs WHERE id = ?").get(jobId);

  function save(steps, log) {
    db.prepare("UPDATE jobs SET progress = ?, log = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ steps }),
      JSON.stringify(log.slice(-MAX_LOG)),
      nowIso(),
      jobId
    );
  }

  function mutate(fn) {
    const row = read();
    if (!row) return;
    const steps = parse(row.progress, {}).steps || freshSteps();
    const log = parse(row.log, []);
    fn(steps, log);
    save(steps, log);
  }

  const at = (steps, key) => steps.find((s) => s.key === key);

  return {
    /** Start an attempt: steps reset, the log keeps earlier attempts for context. */
    begin(attempt = 1) {
      db.prepare("UPDATE jobs SET started_at = ?, finished_at = '' WHERE id = ?").run(nowIso(), jobId);
      mutate((steps, log) => {
        steps.splice(0, steps.length, ...freshSteps());
        log.push({ t: nowIso(), level: "info", msg: attempt > 1 ? `Attempt ${attempt} started.` : "Run started." });
      });
    },
    step(key, detail = "") {
      mutate((steps, log) => {
        const s = at(steps, key);
        if (!s) return;
        s.state = "running";
        s.detail = detail;
        log.push({ t: nowIso(), level: "info", msg: `${s.label}${detail ? ` — ${detail}` : ""}` });
      });
    },
    done(key, detail, state = "done") {
      mutate((steps, log) => {
        const s = at(steps, key);
        if (!s) return;
        s.state = state;
        if (detail !== undefined) s.detail = detail;
        log.push({ t: nowIso(), level: state === "failed" ? "error" : "ok", msg: `${s.label}: ${s.detail || state}` });
      });
    },
    skip(key, detail) {
      this.done(key, detail, "skipped");
    },
    log(msg, level = "info") {
      mutate((_steps, log) => log.push({ t: nowIso(), level, msg: String(msg).slice(0, 400) }));
    },
    /** Mark whichever step was running as failed, with the error as its detail. */
    fail(message) {
      mutate((steps, log) => {
        const running = steps.find((s) => s.state === "running");
        if (running) {
          running.state = "failed";
          running.detail = String(message).slice(0, 240);
        }
        log.push({ t: nowIso(), level: "error", msg: String(message).slice(0, 400) });
      });
    },
  };
}

/** A reporter that does nothing — for direct buildCover calls outside the queue. */
export const nullReporter = {
  begin() {},
  step() {},
  done() {},
  skip() {},
  log() {},
  fail() {},
};

/** The run screen's view of a job row. */
export function jobRunDto(job) {
  if (!job) return null;
  const steps = parse(job.progress, {}).steps || freshSteps();
  const current = steps.findIndex((s) => s.state === "running");
  return {
    id: job.id,
    state: job.state,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    lastError: job.last_error || null,
    createdAt: job.created_at,
    startedAt: job.started_at || null,
    finishedAt: job.finished_at || null,
    step: current >= 0 ? current + 1 : steps.filter((s) => s.state !== "pending").length,
    totalSteps: steps.length,
    steps,
    log: parse(job.log, []),
  };
}

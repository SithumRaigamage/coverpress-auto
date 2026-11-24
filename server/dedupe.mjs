/* Merge duplicate covers: one game + platform is one cover per account.

   Earlier builds created a new cover every time a game was generated again (or
   pasted twice), so the review board could show the same game five times. This
   folds every duplicate into a single canonical cover:

   - The canonical cover is the most recently updated one in the group.
   - Every render of every duplicate moves to it and becomes a version,
     renumbered v1..vN in the order they were made. No render is lost.
   - If any duplicate was approved and the canonical one is not, the canonical
     cover becomes approved with that render as its approved version.
   - Duplicate rows are then deleted (their art rows and finished jobs go with
     them through ON DELETE CASCADE). Art files stay on disk untouched.

   Idempotent: a database with no duplicates is left exactly as it is. Runs at
   start-up inside one transaction. */

import { normTitle } from "./repo.mjs";
import { nowIso } from "./db.mjs";

const parse = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** The identity of a cover: RAWG id when known (source or metadata), else its normalised title. */
export function coverKey(row) {
  const source = parse(row.source) || {};
  const meta = parse(row.meta) || {};
  const rawgId = Number.isInteger(source.rawgId) ? source.rawgId : Number.isInteger(meta.id) ? meta.id : null;
  return `${row.account_id}|${row.platform}|${rawgId ? `rawg:${rawgId}` : `title:${normTitle(row.title)}`}`;
}

export function mergeDuplicateCovers(db, logger = console) {
  const rows = db
    .prepare(
      `SELECT c.*, p.account_id,
              (SELECT MAX(created_at) FROM renders r WHERE r.cover_id = c.id) AS last_render
       FROM covers c JOIN projects p ON p.id = c.project_id`
    )
    .all();

  const groups = new Map();
  for (const row of rows) {
    const key = coverKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const dupes = [...groups.values()].filter((g) => g.length > 1);
  if (!dupes.length) return { groups: 0, removed: 0 };

  let removed = 0;
  db.exec("BEGIN");
  try {
    for (const group of dupes) {
      // Busy covers are left alone this time; their job would race the merge.
      if (group.some((c) => c.status === "queued" || c.status === "processing")) continue;

      group.sort((a, b) => String(b.last_render || b.updated_at).localeCompare(String(a.last_render || a.updated_at)));
      const [canon, ...rest] = group;

      // An approval anywhere in the group is kept, pointing at that cover's approved render.
      const approvedRow = canon.status === "approved" ? null : rest.find((c) => c.status === "approved");
      let approvedRender = canon.approved_render_id || "";
      if (approvedRow) {
        approvedRender =
          approvedRow.approved_render_id ||
          db.prepare("SELECT id FROM renders WHERE cover_id = ? ORDER BY version DESC LIMIT 1").get(approvedRow.id)?.id ||
          "";
      }

      // Park every version number out of the way first (unique per row via rowid),
      // so moving renders cannot collide on UNIQUE(cover_id, version).
      const park = db.prepare("UPDATE renders SET version = 1000000 + rowid WHERE cover_id = ?");
      for (const c of group) park.run(c.id);
      const move = db.prepare("UPDATE renders SET cover_id = ? WHERE cover_id = ?");
      for (const dup of rest) move.run(canon.id, dup.id);

      // Renumber all versions v1..vN by age.
      const ordered = db.prepare("SELECT id FROM renders WHERE cover_id = ? ORDER BY created_at, rowid").all(canon.id);
      const setVersion = db.prepare("UPDATE renders SET version = ? WHERE id = ?");
      ordered.forEach((r, i) => setVersion.run(i + 1, r.id));

      // Art used by any duplicate counts as used, so variants keep rotating forward.
      const sources = group.map((c) => parse(c.source) || {});
      const merged = { ...sources.find((s) => s.rawgId) , ...(parse(canon.source) || {}) };
      merged.usedFront = [...new Set(sources.flatMap((s) => s.usedFront || (s.front?.url ? [s.front.url] : [])))].slice(-50);
      const rawgId = sources.find((s) => Number.isInteger(s.rawgId))?.rawgId;
      if (rawgId && !merged.rawgId) merged.rawgId = rawgId;

      db.prepare("UPDATE covers SET source = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), nowIso(), canon.id);
      if (approvedRow) {
        db.prepare("UPDATE covers SET status = 'approved', decided_at = ?, approved_render_id = ? WHERE id = ?").run(
          approvedRow.decided_at || nowIso(),
          approvedRender,
          canon.id
        );
      }

      const del = db.prepare("DELETE FROM covers WHERE id = ?");
      for (const dup of rest) {
        del.run(dup.id);
        removed++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  if (removed) logger.log?.(`merged ${removed} duplicate cover${removed === 1 ? "" : "s"} into their games' version history`);
  return { groups: dupes.length, removed };
}

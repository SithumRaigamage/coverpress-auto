#!/usr/bin/env node
/* Operator commands. Deliberately not HTTP endpoints: plan changes and usage
   reports are deployment concerns, not part of the local JSON API.

   npm run plan <email> <free|studio>
   npm run usage                       */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";
import { PLANS, usageThisMonth, projectCount } from "./auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const db = openDb(process.env.DB_FILE || path.join(dataDir, "coverpress.sqlite"));
const [, , cmd, ...args] = process.argv;

const find = (email) =>
  db.prepare("SELECT * FROM accounts WHERE lower(email) = lower(?)").get(String(email || "")) ||
  db.prepare("SELECT * FROM accounts ORDER BY created_at LIMIT 1").get();

try {
  if (cmd === "plan") {
    const [first, second] = args;
    // `npm run plan studio` targets the local account; an explicit email is optional.
    const plan = second || first;
    const email = second ? first : undefined;
    if (!PLANS[plan]) throw new Error(`Usage: npm run plan [<email>] <${Object.keys(PLANS).join("|")}>`);
    const account = find(email);
    if (!account) throw new Error(`No account found for ${email || "(local)"}. Start the app once first.`);
    db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, account.id);
    console.log(`${account.email} → ${PLANS[plan].label} (${PLANS[plan].coversPerMonth} covers/month)`);
  } else if (cmd === "usage") {
    const rows = db.prepare("SELECT * FROM accounts ORDER BY created_at").all();
    if (!rows.length) console.log("No accounts yet.");
    for (const row of rows) {
      const plan = PLANS[row.plan] || PLANS.free;
      console.log(
        `${row.email.padEnd(32)} ${String(usageThisMonth(db, row.id)).padStart(3)}/${String(plan.coversPerMonth).padEnd(4)} covers  ` +
          `${String(projectCount(db, row.id)).padStart(2)}/${plan.projects} projects  (${plan.label})`
      );
    }
  } else {
    console.log("Commands: plan <email> <free|studio> | usage");
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}

#!/usr/bin/env node
/* Operator CLI: inspect the local account, flip its plan after a manual invoice.
   Deliberately not an HTTP endpoint — plan changes are an operator action.

     node server/cli.mjs usage
     node server/cli.mjs plan studio
*/

import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";
import * as auth from "./auth.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(ROOT, "..", "data");
const dbFile = process.env.DB_FILE || path.join(dataDir, "coverpress.sqlite");

const [cmd = "help", ...args] = process.argv.slice(2);
const db = openDb(dbFile);

/** The account the API runs as: the oldest row, same rule as localAccount(). */
const localAccount = () => db.prepare("SELECT * FROM accounts ORDER BY created_at LIMIT 1").get();

switch (cmd) {
  case "plan": {
    const [plan] = args;
    if (!(plan in auth.PLANS)) {
      console.error(`usage: node server/cli.mjs plan <${Object.keys(auth.PLANS).join("|")}>`);
      process.exitCode = 1;
      break;
    }
    const account = localAccount();
    if (!account) {
      console.error("no account yet — start the API once to create it");
      process.exitCode = 1;
      break;
    }
    db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, account.id);
    console.log(`${account.email} is now on ${auth.PLANS[plan].label}`);
    break;
  }

  case "usage": {
    const account = localAccount();
    if (!account) {
      console.log("No account yet.");
      break;
    }
    const plan = auth.planOf(account);
    console.log(`${account.email} · ${account.plan}`);
    console.log(`covers this month: ${auth.usageThisMonth(db, account.id)}/${plan.coversPerMonth}`);
    console.log(`projects: ${auth.projectCount(db, account.id)}/${plan.projects}`);
    break;
  }

  default:
    console.log(`Coverpress operator CLI

  node server/cli.mjs usage           covers and projects used this month
  node server/cli.mjs plan <plan>     set ${Object.keys(auth.PLANS).join(" or ")}

Database: ${dbFile}`);
}

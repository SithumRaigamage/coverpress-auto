/* Plans, quotas and sealed provider keys.

   Accounts and sessions are gone for now: the app runs in single-account local
   mode (see server/index.mjs). The schema is unchanged — every project still
   belongs to an account_id — so turning accounts back on later is a routing
   change, not a data migration. Password/session code was deleted rather than
   left dormant: unused auth code is a liability, not a head start.

   Provider keys are sealed with AES-256-GCM under APP_SECRET (or a 0600 key file
   in the data directory) and are never returned to a client, only used
   server-side. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nowIso, monthStart } from "./db.mjs";

export const PLANS = {
  free: { label: "Free", coversPerMonth: 10, projects: 2, price: 0 },
  studio: { label: "Studio", coversPerMonth: 500, projects: 50, price: 19 },
};

export const planOf = (account) => PLANS[account?.plan] || PLANS.free;

/* ---------------------------------------------------------------- quota */

export function usageThisMonth(db, accountId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM usage_events
       WHERE account_id = ? AND kind = 'cover.created' AND created_at >= ?`
    )
    .get(accountId, monthStart());
  return Number(row?.n || 0);
}

export function projectCount(db, accountId) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM projects WHERE account_id = ?").get(accountId)?.n || 0);
}

/** Returns null when the account may create `wanted` more covers this month. */
export function quotaBlockReason(db, account, wanted = 1) {
  const plan = planOf(account);
  const used = usageThisMonth(db, account.id);
  if (used + wanted > plan.coversPerMonth) {
    return {
      code: "quota_exceeded",
      message: `The ${plan.label} plan includes ${plan.coversPerMonth} covers a month and ${used} are used. Re-rendering existing covers is still free.`,
      used,
      limit: plan.coversPerMonth,
    };
  }
  return null;
}

export function recordUsage(db, accountId, kind, ref = "") {
  db.prepare("INSERT INTO usage_events (id, account_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    accountId,
    kind,
    ref,
    nowIso()
  );
}

/* --------------------------------------------------- sealed provider keys */

// SteamGridDB is deliberately absent: its terms are personal, non-commercial
// use only, so this service cannot hold a key for it.
const KEY_NAMES = new Set(["rawg", "openrouter"]);

export function loadSecret(dataDir, envSecret) {
  if (envSecret && String(envSecret).length >= 16) {
    return crypto.createHash("sha256").update(String(envSecret)).digest();
  }
  const file = path.join(dataDir, "secret.key");
  try {
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch {
    fs.mkdirSync(dataDir, { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
    return key;
  }
}

export function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function unseal(sealed, key) {
  try {
    const [iv, tag, ct] = String(sealed).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function setProviderKey(db, accountId, name, value, secret) {
  if (!KEY_NAMES.has(name)) {
    const err = new Error(`Unknown or unsupported provider "${name}".`);
    err.status = 400;
    throw err;
  }
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    db.prepare("DELETE FROM provider_keys WHERE account_id = ? AND name = ?").run(accountId, name);
    return;
  }
  db.prepare(
    `INSERT INTO provider_keys (account_id, name, sealed, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at`
  ).run(accountId, name, seal(trimmed, secret), nowIso());
}

/** Names only — never values. */
export function providerKeyNames(db, accountId) {
  const rows = db.prepare("SELECT name FROM provider_keys WHERE account_id = ? ORDER BY name").all(accountId);
  return new Set(rows.map((r) => r.name));
}

export function providerKey(db, accountId, name, secret) {
  const row = db.prepare("SELECT sealed FROM provider_keys WHERE account_id = ? AND name = ?").get(accountId, name);
  return row ? unseal(row.sealed, secret) : "";
}

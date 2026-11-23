/* Storage-layer invariants that outlive the presentation layer: account scoping,
   sealed keys, and quota arithmetic. No HTTP here. */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, nowIso } from "../server/db.mjs";
import * as repo from "../server/repo.mjs";
import { seal, unseal, planOf, quotaBlockReason, recordUsage, usageThisMonth, PLANS } from "../server/auth.mjs";

const db = openDb(":memory:");

const addAccount = (db, email) => {
  const id = `acc-${email}`;
  db.prepare("INSERT INTO accounts (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, 'free', ?)").run(
    id,
    email,
    "x",
    nowIso()
  );
  return id;
};

const alice = addAccount(db, "alice@example.com");
const bob = addAccount(db, "bob@example.com");

const aliceProject = repo.createProject(db, alice, { name: "Alice shelf" });
const bobProject = repo.createProject(db, bob, { name: "Bob shelf" });
const bobCover = repo.createCover(db, bob, bobProject.id, { title: "Bob's game", platform: "PS5" });
const bobRender = repo.addRender(db, bobCover.id, {
  wrapPath: "renders/bob/wrap.png",
  frontPath: "renders/bob/front.png",
  qc: { score: 90 },
  cfg: {},
});

test("an account cannot read another account's project, cover or render", () => {
  assert.equal(repo.getProject(db, alice, bobProject.id), null);
  assert.equal(repo.getCover(db, alice, bobCover.id), null);
  assert.equal(repo.getRender(db, alice, bobRender.id), null);
  assert.equal(repo.listCoversWithRender(db, alice, bobProject.id).length, 0);
  assert.equal(repo.approvedRenders(db, alice, bobProject.id).length, 0);

  assert.ok(repo.getProject(db, bob, bobProject.id));
  assert.ok(repo.getCover(db, bob, bobCover.id));
  assert.ok(repo.getRender(db, bob, bobRender.id));
});

test("listings and summaries only count the calling account", () => {
  assert.deepEqual(
    repo.listProjects(db, alice).map((p) => p.name),
    ["Alice shelf"]
  );
  assert.equal(repo.projectSummary(db, alice, bobProject.id).total, 0);
  assert.equal(repo.projectSummary(db, bob, bobProject.id).total, 1);
  assert.equal(repo.projectMosaics(db, alice)[bobProject.id], undefined);
});

test("plans fall back safely and quota maths is per account", () => {
  assert.equal(planOf({ plan: "nonsense" }), PLANS.free);
  assert.equal(planOf({ plan: "studio" }).coversPerMonth, 500);

  for (let i = 0; i < PLANS.free.coversPerMonth; i++) recordUsage(db, alice, "cover.created");
  const blocked = quotaBlockReason(db, { id: alice, plan: "free" });
  assert.equal(blocked.code, "quota_exceeded");
  assert.equal(blocked.limit, PLANS.free.coversPerMonth);
  assert.equal(usageThisMonth(db, bob), 0);
  assert.equal(quotaBlockReason(db, { id: bob, plan: "free" }), null);
});

test("sealed values round-trip and reject tampering", () => {
  const key = Buffer.alloc(32, 7);
  const sealed = seal("rawg-secret", key);
  assert.equal(unseal(sealed, key), "rawg-secret");
  assert.equal(unseal(sealed, Buffer.alloc(32, 8)), "");
  assert.equal(unseal("garbage", key), "");
});

test("a database file is created on first use", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverpress-db-"));
  const file = path.join(dir, "nested", "db.sqlite");
  const opened = openDb(file);
  assert.ok(fs.existsSync(file));
  assert.equal(opened.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 0);
  opened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

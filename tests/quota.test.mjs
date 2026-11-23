/* Quota and single-account behaviour. Each test boots its own instance so the
   monthly usage window starts at zero. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, createProject, importTitles, getJson, post, get } from "./helpers.mjs";
import { PLANS, usageThisMonth } from "../server/auth.mjs";

const withServer = async (fn) => {
  const server = await boot();
  try {
    await fn(server);
  } finally {
    await server.stop();
  }
};

test("the free plan caps covers per month and says so", async () => {
  await withServer(async (server) => {
    const projectId = await createProject(server.url, "Big shelf");
    const titles = Array.from({ length: PLANS.free.coversPerMonth + 2 }, (_, i) => `Game ${i + 1}`).join("\n");
    const res = await importTitles(server.url, projectId, titles);
    const body = await res.json();
    assert.equal(body.created.length, PLANS.free.coversPerMonth);
    assert.equal(body.skipped, 2);
    assert.match(body.message, /2 held back by the 10-cover limit/);

    const count = server.app.db
      .prepare("SELECT COUNT(*) AS n FROM covers c JOIN projects p ON p.id = c.project_id WHERE p.id = ?")
      .get(projectId);
    assert.equal(Number(count.n), PLANS.free.coversPerMonth);
  });
});

test("a second free import is fully held back", async () => {
  await withServer(async (server) => {
    const projectId = await createProject(server.url, "Shelf");
    await importTitles(
      server.url,
      projectId,
      Array.from({ length: PLANS.free.coversPerMonth }, (_, i) => `One ${i}`).join("\n")
    );
    const body = await (await importTitles(server.url, projectId, "Overflow")).json();
    assert.equal(body.created.length, 0);
    assert.equal(body.skipped, 1);
    assert.match(body.message, /0 covers added/);
  });
});

test("the free plan caps projects", async () => {
  await withServer(async (server) => {
    for (let i = 0; i < PLANS.free.projects; i++) await createProject(server.url, `Shelf ${i}`);
    const res = await post(server.url, "/api/projects", { name: "Too many" });
    assert.equal(res.status, 402);
    assert.match((await res.json()).error, /includes 2 projects/);
  });
});

test("upgrading the plan lifts both caps", async () => {
  await withServer(async (server) => {
    server.app.db.prepare("UPDATE accounts SET plan = 'studio'").run();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await createProject(server.url, `Studio ${i}`));

    const titles = Array.from({ length: 15 }, (_, i) => `Bulk ${i}`).join("\n");
    const body = await (await importTitles(server.url, ids[0], titles)).json();
    assert.equal(body.created.length, 15);

    const me = await getJson(server.url, "/api/me");
    assert.equal(me.body.account.plan.name, "studio");
    assert.equal(me.body.account.usage.limit, PLANS.studio.coversPerMonth);
  });
});

test("re-rendering an existing cover does not spend quota", async () => {
  await withServer(async (server) => {
    const projectId = await createProject(server.url, "Shelf");
    await importTitles(server.url, projectId, "Only One");
    const coverId = server.app.db.prepare("SELECT id FROM covers WHERE project_id = ?").get(projectId).id;
    const usedBefore = usageThisMonth(server.app.db, server.app.account.id);

    await post(server.url, `/api/covers/${coverId}/render`, { zoom: 1.2 });
    const usedAfter = usageThisMonth(server.app.db, server.app.account.id);

    assert.equal(usedAfter, usedBefore);
    assert.equal((await get(server.url, "/api/me")).status, 200);
  });
});

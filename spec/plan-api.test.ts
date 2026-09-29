import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiError, PlannerState } from "../src/lib/contracts";
import { termOrder } from "../src/lib/engine/index";

// The plan HTTP API (PLAN.md §3.2), driven over HTTP against the BUILT
// server with real cookie jars. This file runs its own server on its own
// database so it can restart the process and read the SQLite file directly.
// Assertions are scoped to entries by id (plan.entries[].id), never substring
// matches (LEARNINGS: weak-assertion class).

const ROOT = resolve(import.meta.dirname, "..");

// Success responses carry evaluatePlan's output, so until track B's engine
// replaces the Wave 0 stub those tests can't run. They switch on by
// themselves the moment the stub stops throwing.
const ENGINE_READY = (() => {
  try {
    termOrder(1, "S1");
    return true;
  } catch {
    return false;
  }
})();
if (!ENGINE_READY) console.warn("plan-api: engine is the Wave 0 stub --- engine-dependent tests SKIPPED");

let child: ChildProcess;
let base = "";
const dbPath = join(mkdtempSync(join(tmpdir(), "plan-api-")), "app.db");

async function start(): Promise<void> {
  const port = await new Promise<number>((ok) => {
    const probe = createServer();
    probe.listen(0, () => {
      const p = (probe.address() as AddressInfo).port;
      probe.close(() => ok(p));
    });
  });
  child = spawn("node", [join(ROOT, "dist/server/entry.mjs")], {
    cwd: ROOT,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: dbPath },
    stdio: "ignore",
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      // not up yet
    }
    if (i > 75) throw new Error("server did not come up");
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function stop(): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((ok) => {
    child.once("exit", () => ok());
    child.kill();
  });
}
async function restart(): Promise<void> {
  await stop();
  await start();
}

beforeAll(start, 30_000);
afterAll(stop, 30_000);

/** One browser: keeps the dp_plan cookie the server hands out. */
class Jar {
  cookie: string | null = null;
  async send(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<Response> {
    // same-origin, as a browser would send it: Astro's origin check answers a
    // cross-origin *form* POST with 403 before our handler runs
    const headers: Record<string, string> = { origin: base };
    if (this.cookie) headers.cookie = `dp_plan=${this.cookie}`;
    if (method !== "GET") headers["content-type"] = contentType;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const m = /^dp_plan=([^;]+)/.exec(c);
      if (m) this.cookie = m[1];
    }
    return res;
  }
  async state(): Promise<PlannerState> {
    const res = await this.send("GET", "/api/plan");
    expect(res.status).toBe(200);
    return (await res.json()) as PlannerState;
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  return (await res.json()) as ApiError;
}

function sqlite<T>(sql: string, ...params: unknown[]): T[] {
  const db = new Database(dbPath);
  try {
    db.pragma("wal_checkpoint(FULL)");
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

describe("identity and plumbing (no engine needed)", () => {
  it("hands out an httpOnly, SameSite=Lax, 22-char dp_plan cookie (not Secure over http)", async () => {
    const res = await fetch(`${base}/`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("dp_plan="));
    expect(cookie).toMatch(/^dp_plan=[A-Za-z0-9_-]{22};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("keeps a valid cookie instead of minting a new one", async () => {
    const jar = new Jar();
    await jar.send("GET", "/");
    const first = jar.cookie;
    const res = await jar.send("GET", "/");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("dp_plan="))).toBe(false);
    expect(jar.cookie).toBe(first);
  });

  it("GET-only visitors create no plans row", async () => {
    const jar = new Jar();
    await jar.send("GET", "/");
    expect(sqlite("SELECT id FROM plans WHERE id = ?", jar.cookie)).toEqual([]);
  });

  it("GET /api/events is a text/event-stream with a non-empty body (the CI deploy probe)", async () => {
    const res = await fetch(`${base}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it.each([
    ["POST", "/api/plan/entries"],
    ["PATCH", "/api/plan"],
    ["DELETE", "/api/plan"],
    ["PATCH", "/api/plan/entries/1"],
    ["DELETE", "/api/plan/entries/1"],
  ])("%s %s answers 415 UNSUPPORTED_MEDIA to a form content type", async (method, path) => {
    const res = await new Jar().send(method, path, "code=COMP1100", "application/x-www-form-urlencoded");
    expect(res.status).toBe(415);
    expect((await errorOf(res)).error).toBe("UNSUPPORTED_MEDIA");
  });

  it.each([
    ["not JSON", "{nope"],
    ["bad code", { code: "comp", year: 1, period: "S1", slot: 0 }],
    ["bad period", { code: "COMP1100", year: 1, period: "WINTER", slot: 0 }],
    ["slot out of range", { code: "COMP1100", year: 1, period: "S1", slot: 4 }],
    ["summer slot out of range", { code: "COMP1100", year: 1, period: "SUMMER", slot: 2 }],
    ["year beyond the plan", { code: "COMP1100", year: 4, period: "S1", slot: 0 }],
    ["summer row not in the plan", { code: "COMP1100", year: 1, period: "SUMMER", slot: 0 }],
  ])("POST /api/plan/entries: 400 INVALID for %s", async (_why, body) => {
    const res = await new Jar().send("POST", "/api/plan/entries", body);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toBe("INVALID");
  });
});

describe.skipIf(!ENGINE_READY)("plan API (needs the engine)", { timeout: 30_000 }, () => {
  it("an unknown id gets the default empty plan", async () => {
    const s = await new Jar().state();
    expect(s.plan).toEqual({ years: 3, summerYears: [], entries: [] });
    expect(s.evaluation.totalUnits).toBe(0);
  });

  it("add -> 201 PlannerState -> GET shows that entry; the row's plan_id is the cookie", async () => {
    const jar = new Jar();
    const res = await jar.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 });
    expect(res.status).toBe(201);
    const added = ((await res.json()) as PlannerState).plan.entries;
    expect(added).toHaveLength(1);
    const id = added[0].id;
    const got = (await jar.state()).plan.entries.find((e) => e.id === id);
    expect(got).toEqual({ id, code: "COMP1100", year: 1, period: "S1", slot: 0 });
    expect(sqlite("SELECT plan_id, course_code, year, period, slot FROM plan_entries WHERE id = ?", id)).toEqual([
      { plan_id: jar.cookie, course_code: "COMP1100", year: 1, period: "S1", slot: 0 },
    ]);
  });

  it("two cookie jars get independent plans", async () => {
    const a = new Jar();
    const b = new Jar();
    await a.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 });
    await b.send("POST", "/api/plan/entries", { code: "MATH1013", year: 2, period: "S2", slot: 3 });
    expect((await a.state()).plan.entries.map((e) => e.code)).toEqual(["COMP1100"]);
    expect((await b.state()).plan.entries.map((e) => e.code)).toEqual(["MATH1013"]);
    expect(a.cookie).not.toBe(b.cookie);
  });

  it("a requisite violation is still 201, and the evaluation flags it", async () => {
    const jar = new Jar();
    const res = await jar.send("POST", "/api/plan/entries", { code: "COMP3600", year: 1, period: "S1", slot: 0 });
    expect(res.status).toBe(201);
    const s = (await res.json()) as PlannerState;
    const id = s.plan.entries[0].id;
    expect(s.evaluation.entries[id].state).toBe("violation");
    // the course and what it references arrive as catalogueAdditions
    expect(s.catalogueAdditions?.map((c) => c.code)).toContain("COMP3600");
  });

  it("404 UNKNOWN_COURSE, 409 SLOT_TAKEN, 409 ALREADY_PLANNED", async () => {
    const jar = new Jar();
    await jar.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 });
    const unknown = await jar.send("POST", "/api/plan/entries", { code: "ZZZZ9999", year: 1, period: "S1", slot: 1 });
    expect([unknown.status, (await errorOf(unknown)).error]).toEqual([404, "UNKNOWN_COURSE"]);
    const taken = await jar.send("POST", "/api/plan/entries", { code: "COMP1600", year: 1, period: "S1", slot: 0 });
    expect([taken.status, (await errorOf(taken)).error]).toEqual([409, "SLOT_TAKEN"]);
    const again = await jar.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S2", slot: 0 });
    expect([again.status, (await errorOf(again)).error]).toEqual([409, "ALREADY_PLANNED"]);
    expect((await jar.state()).plan.entries).toHaveLength(1);
  });

  it("an entry, a move and the plan shape survive a server restart", async () => {
    const jar = new Jar();
    await jar.send("PATCH", "/api/plan", { years: 4, summerYears: [1] });
    const res = await jar.send("POST", "/api/plan/entries", { code: "COMP1600", year: 1, period: "S1", slot: 2 });
    const id = ((await res.json()) as PlannerState).plan.entries[0].id;

    await restart();
    let s = await jar.state();
    expect(s.plan.years).toBe(4);
    expect(s.plan.summerYears).toEqual([1]);
    expect(s.plan.entries.find((e) => e.id === id)).toMatchObject({ code: "COMP1600", year: 1, period: "S1", slot: 2 });

    const moved = await jar.send("PATCH", `/api/plan/entries/${id}`, { year: 1, period: "SUMMER", slot: 1 });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as PlannerState).plan.entries.find((e) => e.id === id)).toMatchObject({
      year: 1,
      period: "SUMMER",
      slot: 1,
    });

    await restart();
    s = await jar.state();
    expect(s.plan.entries.find((e) => e.id === id)).toMatchObject({ code: "COMP1600", year: 1, period: "SUMMER", slot: 1 });
    expect(sqlite("SELECT year, period, slot FROM plan_entries WHERE id = ?", id)).toEqual([
      { year: 1, period: "SUMMER", slot: 1 },
    ]);
  });

  it("PATCH /api/plan/entries/:id: 404 for another plan's entry, 409 SLOT_TAKEN, 400 INVALID", async () => {
    const owner = new Jar();
    const other = new Jar();
    const a = ((await (await owner.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 })).json()) as PlannerState).plan.entries[0].id;
    await owner.send("POST", "/api/plan/entries", { code: "COMP1600", year: 1, period: "S2", slot: 0 });
    await other.send("GET", "/");

    const foreign = await other.send("PATCH", `/api/plan/entries/${a}`, { year: 2, period: "S1", slot: 0 });
    expect([foreign.status, (await errorOf(foreign)).error]).toEqual([404, "NOT_FOUND"]);
    const taken = await owner.send("PATCH", `/api/plan/entries/${a}`, { year: 1, period: "S2", slot: 0 });
    expect([taken.status, (await errorOf(taken)).error]).toEqual([409, "SLOT_TAKEN"]);
    const invalid = await owner.send("PATCH", `/api/plan/entries/${a}`, { year: 1, period: "SUMMER", slot: 0 });
    expect([invalid.status, (await errorOf(invalid)).error]).toEqual([400, "INVALID"]);
    expect((await owner.state()).plan.entries.find((e) => e.id === a)).toMatchObject({ year: 1, period: "S1", slot: 0 });
  });

  it("DELETE /api/plan/entries/:id removes only this plan's entry; 404 otherwise", async () => {
    const owner = new Jar();
    const other = new Jar();
    const id = ((await (await owner.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 })).json()) as PlannerState).plan.entries[0].id;
    await other.send("GET", "/");
    const foreign = await other.send("DELETE", `/api/plan/entries/${id}`);
    expect([foreign.status, (await errorOf(foreign)).error]).toEqual([404, "NOT_FOUND"]);
    expect((await owner.state()).plan.entries.map((e) => e.id)).toEqual([id]);
    const mine = await owner.send("DELETE", `/api/plan/entries/${id}`);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as PlannerState).plan.entries).toEqual([]);
    const gone = await owner.send("DELETE", `/api/plan/entries/${id}`);
    expect(gone.status).toBe(404);
  });

  it("PATCH /api/plan: 409 YEAR_NOT_EMPTY with the count, then discardEntries removes them", async () => {
    const jar = new Jar();
    await jar.send("PATCH", "/api/plan", { summerYears: [2] });
    await jar.send("POST", "/api/plan/entries", { code: "COMP1100", year: 3, period: "S1", slot: 0 });
    await jar.send("POST", "/api/plan/entries", { code: "COMP1600", year: 3, period: "S2", slot: 1 });
    await jar.send("POST", "/api/plan/entries", { code: "MATH1013", year: 2, period: "SUMMER", slot: 0 });
    const keep = ((await jar.state()).plan.entries.find((e) => e.code === "MATH1013"))?.id;

    const blocked = await jar.send("PATCH", "/api/plan", { years: 2 });
    expect(blocked.status).toBe(409);
    expect(await errorOf(blocked)).toMatchObject({ error: "YEAR_NOT_EMPTY", entries: 2 });
    const summer = await jar.send("PATCH", "/api/plan", { summerYears: [] });
    expect(await errorOf(summer)).toMatchObject({ error: "YEAR_NOT_EMPTY", entries: 1 });
    expect((await jar.state()).plan.entries).toHaveLength(3);

    const ok = await jar.send("PATCH", "/api/plan", { years: 2, discardEntries: true });
    expect(ok.status).toBe(200);
    const s = (await ok.json()) as PlannerState;
    expect(s.plan.years).toBe(2);
    expect(s.plan.entries.map((e) => e.id)).toEqual([keep]);

    for (const bad of [{ years: 0 }, { years: 7 }, { summerYears: [3] }, { years: "2" }]) {
      const r = await jar.send("PATCH", "/api/plan", bad);
      expect([r.status, (await errorOf(r)).error], JSON.stringify(bad)).toEqual([400, "INVALID"]);
    }
  });

  it("DELETE /api/plan clears entries and resets the shape", async () => {
    const jar = new Jar();
    await jar.send("PATCH", "/api/plan", { years: 5, summerYears: [1, 2] });
    await jar.send("POST", "/api/plan/entries", { code: "COMP1100", year: 1, period: "S1", slot: 0 });
    const res = await jar.send("DELETE", "/api/plan");
    expect(res.status).toBe(200);
    expect(((await res.json()) as PlannerState).plan).toEqual({ years: 3, summerYears: [], entries: [] });
    expect(sqlite("SELECT id FROM plan_entries WHERE plan_id = ?", jar.cookie)).toEqual([]);
  });

  it("GET /api/courses/:code returns the description; 404 UNKNOWN_COURSE otherwise", async () => {
    const res = await fetch(`${base}/api/courses/COMP2100`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { course: { code: string; description: string }; dependents: string[] };
    expect(body.course.code).toBe("COMP2100");
    expect(body.course.description.length).toBeGreaterThan(body.course.code.length);
    const missing = await fetch(`${base}/api/courses/ZZZZ9999`);
    expect([missing.status, (await errorOf(missing)).error]).toEqual([404, "UNKNOWN_COURSE"]);
  });
});

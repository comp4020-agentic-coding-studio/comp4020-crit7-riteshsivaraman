import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogueFile, CatalogueIndexFile } from "../src/lib/contracts";

// Boot sync + migration 0001, end to end (PLAN.md §2.3-2.4, §5.3 A): spawns
// the BUILT server against (a) an empty DB and (b) a database left by the v1
// schema, then reads the SQLite file directly --- never the app's own account
// of itself. Each server gets its own cwd holding drizzle/ and a private copy
// of catalogue/, so a test can edit the catalogue without touching the repo.

const ROOT = resolve(import.meta.dirname, "..");
const ENTRY = join(ROOT, "dist/server/entry.mjs");

async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const probe = createServer();
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => ok(port));
    });
  });
}

interface Booted {
  url: string;
  logs: () => string;
  stop: () => Promise<void>;
}
const running: Booted[] = [];
afterEach(async () => {
  while (running.length) await running.pop()?.stop();
}, 30_000);

async function boot(cwd: string, dbPath: string): Promise<Booted> {
  const port = await freePort();
  let out = "";
  const child: ChildProcess = spawn("node", [ENTRY], {
    cwd,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => (out += String(d)));
  child.stderr?.on("data", (d) => (out += String(d)));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}:\n${out}`);
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 75) {
      child.kill();
      throw new Error(`server did not come up:\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const booted: Booted = {
    url,
    logs: () => out,
    stop: () =>
      new Promise((ok) => {
        if (child.exitCode !== null || child.signalCode !== null) return ok();
        child.once("exit", () => ok());
        child.kill();
      }),
  };
  running.push(booted);
  return booted;
}

function workdir(): { cwd: string; db: string } {
  const cwd = mkdtempSync(join(tmpdir(), "boot-sync-"));
  symlinkSync(join(ROOT, "drizzle"), join(cwd, "drizzle"));
  cpSync(join(ROOT, "catalogue"), join(cwd, "catalogue"), {
    recursive: true,
    filter: (src) => !src.includes(`${join("catalogue", "raw")}`),
  });
  return { cwd, db: join(cwd, "app.db") };
}

function query<T>(dbPath: string, sql: string, ...params: unknown[]): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const index = JSON.parse(readFileSync(join(ROOT, "catalogue/index.json"), "utf8")) as CatalogueIndexFile;
const catalogueCount = index.subjects.reduce((n, s) => n + s.count, 0);

/** A database exactly as v1 left it: migration 0000 applied, v1 rows added. */
function makeV1Database(dbPath: string): void {
  const migrations = mkdtempSync(join(tmpdir(), "v1-migrations-"));
  mkdirSync(join(migrations, "meta"));
  const journal = JSON.parse(readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  writeFileSync(join(migrations, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));
  copyFileSync(join(ROOT, `drizzle/${journal.entries[0].tag}.sql`), join(migrations, `${journal.entries[0].tag}.sql`));
  const client = new Database(dbPath);
  migrate(drizzle(client), { migrationsFolder: migrations });
  const courses = [
    ["COMP1100", "COMP", "Programming as Problem Solving", 6],
    ["COMP1130", "COMP", "Programming as Problem Solving (Advanced)", 6],
    ["COMP1600", "COMP", "Foundations of Computing", 6],
    ["COMP3600", "COMP", "Algorithms", 6],
    ["ZZZZ1000", "ZZZZ", "A v1 course the v2 catalogue does not have", 6],
  ];
  for (const c of courses) client.prepare("INSERT INTO courses VALUES (?, ?, ?, ?)").run(...c);
  client.prepare("INSERT INTO incompatibilities (course_code, blocked_by_code) VALUES ('COMP1100', 'COMP1130')").run();
  client.prepare("INSERT INTO requisite_nodes (course_code, parent_id, kind, ref_course_code) VALUES ('COMP3600', NULL, 'COURSE', 'COMP1600')").run();
  // three real entries + one duplicate of COMP1100 that v2's unique index forbids
  for (const [code, term] of [["COMP1100", 0], ["COMP1600", 0], ["COMP3600", 3], ["COMP1100", 1]] as const) {
    client.prepare("INSERT INTO plan_entries (course_code, term_index) VALUES (?, ?)").run(code, term);
  }
  client.close();
}

describe("boot sync against an empty database", { timeout: 30_000 }, () => {
  it("creates every course, records the catalogue version, and creates no plan", async () => {
    const { cwd, db } = workdir();
    const server = await boot(cwd, db);
    expect(server.logs()).toContain(`catalogue sync: ${catalogueCount} upserted, 0 retired, version ${index.version} (changed)`);
    await server.stop();

    expect(query<{ n: number }>(db, "SELECT count(*) AS n FROM courses WHERE retired = 0")[0].n).toBe(catalogueCount);
    expect(query<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'catalogue_version'")[0].value).toBe(index.version);
    expect(query<{ n: number }>(db, "SELECT count(*) AS n FROM plans")[0].n).toBe(0);
  });

  it("skips the upsert on a boot where the version is unchanged", async () => {
    const { cwd, db } = workdir();
    await (await boot(cwd, db)).stop();
    const second = await boot(cwd, db);
    expect(second.logs()).toContain(`catalogue sync: up to date (${index.version})`);
  });
});

describe("migration 0001 + boot sync against a v1 database", { timeout: 30_000 }, () => {
  it("keeps v1's entries under plan 'legacy', mapped to year/period/slot, dropping the duplicate", async () => {
    const { cwd, db } = workdir();
    makeV1Database(db);
    await (await boot(cwd, db)).stop();

    expect(query<{ id: string }>(db, "SELECT id FROM plans")).toEqual([{ id: "legacy" }]);
    expect(
      query(db, "SELECT plan_id, course_code, year, period, slot FROM plan_entries ORDER BY id"),
    ).toEqual([
      { plan_id: "legacy", course_code: "COMP1100", year: 1, period: "S1", slot: 0 },
      { plan_id: "legacy", course_code: "COMP1600", year: 1, period: "S1", slot: 1 },
      { plan_id: "legacy", course_code: "COMP3600", year: 2, period: "S2", slot: 0 },
    ]);
    const tables = query<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).not.toContain("requisite_nodes");
    expect(tables).not.toContain("incompatibilities");
    expect(query<{ n: number }>(db, "SELECT count(*) AS n FROM courses WHERE retired = 0")[0].n).toBe(catalogueCount);
    expect(query<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'catalogue_version'")[0].value).toBe(index.version);
    // a v1 course the catalogue doesn't have is kept, retired
    expect(query(db, "SELECT code, retired FROM courses WHERE code = 'ZZZZ1000'")).toEqual([{ code: "ZZZZ1000", retired: 1 }]);
    // the placeholder columns were overwritten by the sync
    const comp1100 = query<{ summary: string; offered_json: string }>(db, "SELECT summary, offered_json FROM courses WHERE code = 'COMP1100'")[0];
    expect(comp1100.summary.length).toBeGreaterThan(0);
    expect(JSON.parse(comp1100.offered_json)).not.toEqual([]);
  });

  it("marks a course removed from the catalogue retired, never deletes it, and keeps its entry", async () => {
    const { cwd, db } = workdir();
    makeV1Database(db);
    await (await boot(cwd, db)).stop();

    // remove COMP3600 from this server's copy of the catalogue (new version)
    const file = join(cwd, "catalogue/COMP.json");
    const comp = (JSON.parse(readFileSync(file, "utf8")) as CatalogueFile["courses"]).filter((c) => c.code !== "COMP3600");
    const text = `${JSON.stringify(comp, null, 1)}\n`;
    writeFileSync(file, text);
    const idx = JSON.parse(readFileSync(join(cwd, "catalogue/index.json"), "utf8")) as CatalogueIndexFile;
    const hash = createHash("sha256");
    for (const s of idx.subjects) hash.update(readFileSync(join(cwd, `catalogue/${s.subject}.json`), "utf8"));
    idx.version = hash.digest("hex").slice(0, 8);
    for (const s of idx.subjects) if (s.subject === "COMP") s.count = comp.length;
    writeFileSync(join(cwd, "catalogue/index.json"), JSON.stringify(idx));

    const server = await boot(cwd, db);
    expect(server.logs()).toContain(`${catalogueCount - 1} upserted, 1 retired, version ${idx.version} (changed)`);
    await server.stop();
    expect(query(db, "SELECT code, retired FROM courses WHERE code = 'COMP3600'")).toEqual([{ code: "COMP3600", retired: 1 }]);
    expect(query(db, "SELECT course_code FROM plan_entries WHERE course_code = 'COMP3600'")).toEqual([{ course_code: "COMP3600" }]);
  });
});

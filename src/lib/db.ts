// Server-only: opens the SQLite file, migrates, syncs the catalogue, and owns
// every read/write of plan state. Never import this from an island.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { formatSyncReport, loadCatalogueCourses, syncCatalogueFromDir, type SyncReport } from "./catalogue-sync";
import type { CatalogueCourse, CatalogueIndex, CatalogueIndexFile, Plan, PlanEntry, PlanPeriod } from "./contracts";
import { isCareer, type Career } from "./career";
import { indexCatalogue } from "./engine/index";
import {
  courses,
  type Course as V1Course,
  plans,
  planEntries,
  type PlanEntry as V1PlanEntry,
  type RequisiteNode as V1RequisiteNode,
} from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
// process.env: SERVER-ONLY (this module runs in the Node server, never ships to the browser).
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");
client.pragma("busy_timeout = 5000");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
//
// Foreign keys OFF while migrating: better-sqlite3 turns them ON by default
// (SQLITE_DEFAULT_FOREIGN_KEYS=1), and a table rebuild (0001 drops and
// recreates `courses`, which plan_entries references) fails under them. The
// pragma is a no-op inside a transaction, so it has to be set here, before
// migrate() opens one. Back ON straight after, and checked.
client.pragma("foreign_keys = OFF");
migrate(db, { migrationsFolder: "./drizzle" });
client.pragma("foreign_keys = ON");
const fkProblems = client.pragma("foreign_key_check") as unknown[];
if (fkProblems.length > 0) throw new Error(`foreign_key_check after migrate: ${JSON.stringify(fkProblems)}`);

// Catalogue: committed files -> courses table, every boot (PLAN.md §2.4).
const synced: { report: SyncReport; index: CatalogueIndexFile } = syncCatalogueFromDir(client, "./catalogue");
console.log(formatSyncReport(synced.report));

export const catalogueMeta = {
  version: synced.index.version,
  scrapedAt: synced.index.scrapedAt,
  source: synced.index.source,
};
export const subjectNames: ReadonlyMap<string, string> = new Map(
  synced.index.subjects.map((s) => [s.subject, s.name] as const),
);

// The in-memory catalogue, loaded once from the DB after sync and immutable
// at runtime. Built lazily so a boot never depends on the engine: requests
// read this, which came from the DB, which came from the file.
const catalogueCourses: readonly CatalogueCourse[] = loadCatalogueCourses(client);
let catalogueIndex: CatalogueIndex | null = null;

export function getCatalogueCourses(): readonly CatalogueCourse[] {
  return catalogueCourses;
}
export function getCatalogue(): CatalogueIndex {
  catalogueIndex ??= indexCatalogue([...catalogueCourses], catalogueMeta.version);
  return catalogueIndex;
}
export function getCourse(code: string): CatalogueCourse | undefined {
  return getCatalogue().byCode.get(code);
}
export function getCourseDescription(code: string): string | undefined {
  const row = client.prepare("SELECT description FROM courses WHERE code = ?").get(code) as
    | { description: string }
    | undefined;
  return row?.description;
}

// ---------------------------------------------------------------------------
// Plans (PLAN.md §3.2). A plans row is created lazily on the first mutation,
// so a GET for an unknown id is the default empty plan and writes nothing.
// ---------------------------------------------------------------------------

export const DEFAULT_YEARS = 3;

function rowToEntry(r: typeof planEntries.$inferSelect): PlanEntry {
  return { id: r.id, code: r.courseCode, year: r.year, period: r.period as PlanPeriod, slot: r.slot };
}

export function getPlan(planId: string): Plan {
  const row = db.select().from(plans).where(eq(plans.id, planId)).get();
  const entries = db
    .select()
    .from(planEntries)
    .where(eq(planEntries.planId, planId))
    .orderBy(asc(planEntries.year), asc(planEntries.period), asc(planEntries.slot))
    .all()
    .map(rowToEntry);
  return {
    years: row?.years ?? DEFAULT_YEARS,
    summerYears: row ? (JSON.parse(row.summerYearsJson) as number[]) : [],
    entries,
    career: isCareer(row?.career) ? row.career : null,
  };
}

function ensurePlan(planId: string): void {
  const now = Date.now();
  db.insert(plans).values({ id: planId, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
}

function touch(planId: string): void {
  db.update(plans).set({ updatedAt: Date.now() }).where(eq(plans.id, planId)).run();
}

/** Runs `fn` in one transaction (better-sqlite3 transactions are synchronous). */
export function inTransaction<T>(fn: () => T): T {
  return client.transaction(fn)();
}

export function insertEntry(planId: string, e: Omit<PlanEntry, "id">): PlanEntry {
  ensurePlan(planId);
  const row = db
    .insert(planEntries)
    .values({ planId, courseCode: e.code, year: e.year, period: e.period, slot: e.slot })
    .returning()
    .get();
  touch(planId);
  return rowToEntry(row);
}

export function moveEntry(planId: string, id: number, to: { year: number; period: PlanPeriod; slot: number }): void {
  db.update(planEntries)
    .set({ year: to.year, period: to.period, slot: to.slot })
    .where(and(eq(planEntries.id, id), eq(planEntries.planId, planId)))
    .run();
  touch(planId);
}

/** Swap the course of an entry in place (same term and slot). */
export function replaceEntryCode(planId: string, id: number, code: string): void {
  db.update(planEntries).set({ courseCode: code }).where(and(eq(planEntries.id, id), eq(planEntries.planId, planId))).run();
  touch(planId);
}

/** Returns false when `id` is not an entry of this plan. */
export function deleteEntry(planId: string, id: number): boolean {
  const res = db.delete(planEntries).where(and(eq(planEntries.id, id), eq(planEntries.planId, planId))).run();
  touch(planId);
  return res.changes > 0;
}

export function updatePlanShape(planId: string, shape: { years: number; summerYears: number[] }, dropEntryIds: number[]): void {
  ensurePlan(planId);
  for (const id of dropEntryIds) {
    db.delete(planEntries).where(and(eq(planEntries.id, id), eq(planEntries.planId, planId))).run();
  }
  db.update(plans)
    .set({ years: shape.years, summerYearsJson: JSON.stringify(shape.summerYears), updatedAt: Date.now() })
    .where(eq(plans.id, planId))
    .run();
}

/** Sets the plan's career. Switching from one career to the other clears
 *  every entry (the old plan was built from the other career's courses). */
export function setCareer(planId: string, career: Career): void {
  ensurePlan(planId);
  const row = db.select().from(plans).where(eq(plans.id, planId)).get();
  // only a real switch clears: a first pick (null) keeps what's already planned
  if (row?.career && row.career !== career) db.delete(planEntries).where(eq(planEntries.planId, planId)).run();
  db.update(plans).set({ career, updatedAt: Date.now() }).where(eq(plans.id, planId)).run();
}

export function resetPlan(planId: string): void {
  db.delete(planEntries).where(eq(planEntries.planId, planId)).run();
  db.update(plans)
    .set({ years: DEFAULT_YEARS, summerYearsJson: "[]", updatedAt: Date.now() })
    .where(eq(plans.id, planId))
    .run();
}

// ---------------------------------------------------------------------------
// v1 SHIMS --- temporary. The v1 pages (index.astro: D; /graph/: E) still call
// these until tracks D and E replace them in Wave 2; delete this block then,
// together with the v1 interfaces at the bottom of schema.ts. They read v2
// state: the courses table, and the "legacy" plan (v1's global plan).
// Requisite nodes are no longer stored, so the v1 pages show none.
// ---------------------------------------------------------------------------

// v1 shim, see above.
// Limited to v1's own 8 courses plus anything in the legacy plan: the v1 page
// renders every course into a <select>, and with the full catalogue that page
// was big enough to stall the course-managed axe invariant for 10+ minutes.
const V1_CODES = ["COMP1100", "COMP1130", "COMP1140", "COMP1600", "COMP2100", "COMP3600", "MATH1013", "MATH1014"];
export function listCourses(): V1Course[] {
  const keep = new Set([...V1_CODES, ...getPlan("legacy").entries.map((e) => e.code)]);
  return db
    .select({ code: courses.code, subject: courses.subject, title: courses.title, units: courses.units })
    .from(courses)
    .where(eq(courses.retired, 0))
    .orderBy(asc(courses.code))
    .all()
    .filter((c) => keep.has(c.code));
}
// v1 shim, see above.
export function listRequisiteNodes(): V1RequisiteNode[] {
  return [];
}
// v1 shim, see above.
export function listPlanEntries(): V1PlanEntry[] {
  return getPlan("legacy").entries
    .filter((e) => e.period !== "SUMMER")
    .map((e) => ({ id: e.id, courseCode: e.code, termIndex: (e.year - 1) * 2 + (e.period === "S2" ? 1 : 0) }));
}

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { seedCourses, seedIncompatibilities, seedRequisiteNodes } from "./seed-data";
import {
  courses,
  type Course,
  incompatibilities,
  type Incompatibility,
  planEntries,
  type PlanEntry,
  requisiteNodes,
  type RequisiteNode,
} from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// The course catalogue is static seed data, not user input, so it's loaded
// once at boot rather than through a migration (which would re-run on every
// deploy). Guarded by the same table being empty, so a redeploy against an
// already-seeded volume is a no-op.
if (db.select().from(courses).limit(1).all().length === 0) {
  db.insert(courses).values(seedCourses).run();
  db.insert(incompatibilities).values(seedIncompatibilities).run();
  db.insert(requisiteNodes).values(seedRequisiteNodes).run();
}

export type { Course, Incompatibility, PlanEntry, RequisiteNode };

export function listCourses(): Course[] {
  return db.select().from(courses).all();
}

export function listRequisiteNodes(): RequisiteNode[] {
  return db.select().from(requisiteNodes).all();
}

export function listIncompatibilities(): Incompatibility[] {
  return db.select().from(incompatibilities).all();
}

export function listPlanEntries(): PlanEntry[] {
  return db.select().from(planEntries).all();
}

export function addPlanEntry(courseCode: string, termIndex: number): PlanEntry {
  return db.insert(planEntries).values({ courseCode, termIndex }).returning().get();
}

export function removePlanEntry(id: number): void {
  db.delete(planEntries).where(eq(planEntries.id, id)).run();
}

import { int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.
//
// PLAN.md §2.1 says where each piece of state lives. In short: the catalogue
// is rebuilt from the committed catalogue/ files on every boot
// (catalogue-sync.ts); plans and their entries are the only user state.

export const meta = sqliteTable("meta", {
  key: text().primaryKey(), // "catalogue_version", "catalogue_synced_at"
  value: text().notNull(),
});

// Read-only reference data, upserted from catalogue/ at boot. A course that
// leaves the catalogue is marked retired, never deleted: plan_entries may
// still point at it. The requisite rule is one JSON column (validated by
// assertRule at boot) rather than a node table, because it is always read
// whole and upserted atomically per course (PLAN.md §2.2).
export const courses = sqliteTable("courses", {
  code: text().primaryKey(), // "COMP2100"
  subject: text().notNull(), // "COMP"
  number: int().notNull(), // 2100
  level: int().notNull(), // 2000 (= floor(number / 1000) * 1000)
  title: text().notNull(),
  units: int().notNull(),
  summary: text().notNull(), // <= 280 chars, sentence-trimmed
  description: text().notNull(), // full P&C description text
  offeredJson: text("offered_json").notNull(), // JSON Period[]
  requisiteText: text("requisite_text"), // verbatim P&C text, null if none
  ruleJson: text("rule_json"), // JSON Rule | null
  parseStatus: text("parse_status").notNull(), // ParseStatus
  incompatibleJson: text("incompatible_json").notNull(), // JSON string[] (symmetric)
  origin: text().notNull(), // "catalogue" | "referenced"
  sourceUrl: text("source_url").notNull(),
  catalogueYear: int("catalogue_year").notNull(), // 2026, or 2025 fallback
  retired: int().notNull().default(0), // 1 = no longer in catalogue/
});

// One plan per browser, keyed by the dp_plan cookie (src/middleware.ts). The
// row is created lazily on the first mutation. v1's single global plan was
// migrated in under the id "legacy", which no cookie can reach.
export const plans = sqliteTable("plans", {
  id: text().primaryKey(), // cookie value, 22-char base64url
  years: int().notNull().default(3), // 1..6
  summerYearsJson: text("summer_years_json").notNull().default("[]"), // JSON number[]
  createdAt: int("created_at").notNull(),
  updatedAt: int("updated_at").notNull(),
});

export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: int().primaryKey({ autoIncrement: true }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    courseCode: text("course_code")
      .notNull()
      .references(() => courses.code),
    year: int().notNull(), // 1-based
    period: text().notNull(), // PlanPeriod
    slot: int().notNull(), // 0..SLOTS[period]-1
  },
  (t) => [
    uniqueIndex("plan_slot_uq").on(t.planId, t.year, t.period, t.slot),
    uniqueIndex("plan_course_uq").on(t.planId, t.courseCode),
  ],
);

export type CourseRow = typeof courses.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type PlanEntryRow = typeof planEntries.$inferSelect;

// ---------------------------------------------------------------------------
// v1 shapes, kept ONLY so v1 code owned by other tracks (src/lib/requisites.ts
// and spec/requisites.test.ts: B; src/lib/graph-layout.ts, the /graph/ page
// and spec/graph-layout.test.ts: E; the v1 index.astro: D) keeps compiling
// until those tracks replace it. These are plain interfaces, not tables:
// nothing in the database has these shapes any more. Delete this block (and
// the v1 shims in db.ts, and seed-data.ts) once nothing imports them.
// ---------------------------------------------------------------------------

// v1 shape; see the note above.
export interface Course {
  code: string;
  subject: string;
  title: string;
  units: number;
}
// v1 shape; see the note above.
export interface RequisiteNode {
  id: number;
  courseCode: string;
  parentId: number | null;
  kind: string;
  refCourseCode: string | null;
  unitSubject: string | null;
  unitCount: number | null;
}
// v1 shape; see the note above.
export interface Incompatibility {
  id: number;
  courseCode: string;
  blockedByCode: string;
}
// v1 shape; see the note above.
export interface PlanEntry {
  id: number;
  courseCode: string;
  termIndex: number;
}

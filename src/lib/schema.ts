import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.

export const courses = sqliteTable("courses", {
  code: text().primaryKey(),
  subject: text().notNull(),
  title: text().notNull(),
  units: int().notNull(),
});

// A course's requisite rule as a small tree, stored flat and assembled in
// TS. `kind` "AND"/"OR" nodes have children (rows whose parentId points at
// them); "COURSE" and "UNIT_COUNT" nodes are leaves. A course with no
// requisites has no rows here at all.
export const requisiteNodes = sqliteTable("requisite_nodes", {
  id: int().primaryKey({ autoIncrement: true }),
  courseCode: text("course_code")
    .notNull()
    .references(() => courses.code),
  parentId: int("parent_id"),
  kind: text().notNull(), // "AND" | "OR" | "COURSE" | "UNIT_COUNT"
  refCourseCode: text("ref_course_code"), // COURSE
  unitSubject: text("unit_subject"), // UNIT_COUNT
  unitCount: int("unit_count"), // UNIT_COUNT
});

// Separate from the AND/OR tree: "must not have completed X" is a different
// kind of check to "must have completed X", and doesn't nest.
export const incompatibilities = sqliteTable("incompatibilities", {
  id: int().primaryKey({ autoIncrement: true }),
  courseCode: text("course_code")
    .notNull()
    .references(() => courses.code),
  blockedByCode: text("blocked_by_code").notNull(),
});

// One implicit global plan (no auth, no multi-user for this prototype), same
// single-state spirit as the guestbook it replaces.
export const planEntries = sqliteTable("plan_entries", {
  id: int().primaryKey({ autoIncrement: true }),
  courseCode: text("course_code")
    .notNull()
    .references(() => courses.code),
  termIndex: int("term_index").notNull(),
});

export type Course = typeof courses.$inferSelect;
export type RequisiteNode = typeof requisiteNodes.$inferSelect;
export type Incompatibility = typeof incompatibilities.$inferSelect;
export type PlanEntry = typeof planEntries.$inferSelect;

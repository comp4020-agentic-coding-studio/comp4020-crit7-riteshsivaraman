// Boot sync: committed catalogue/ files -> `courses` table (PLAN.md §2.4).
// Server-only (node:fs, better-sqlite3); reads no process.env.
//
// The catalogue files are read with fs relative to the process cwd (/app in
// the image), never imported, so the multi-MB JSON is not bundled into the
// server entry. When meta.catalogue_version already equals index.json's
// version only index.json is read and nothing is written, which keeps cold
// starts on the auto-stopping machine fast.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type {
  CatalogueCourse,
  CatalogueFile,
  CatalogueIndexFile,
  InfoKind,
  ParseStatus,
  Period,
  Rule,
} from "./contracts";

type DB = Database.Database;
type FileCourse = CatalogueFile["courses"][number];

export interface SyncReport {
  upserted: number;
  retired: number;
  version: string;
  changed: boolean;
}

const CODE = /^[A-Z]{4}\d{4}$/;
const PERIODS = new Set<Period>(["S1", "S2", "SUMMER", "WINTER", "AUTUMN", "SPRING"]);
const STATUSES = new Set<ParseStatus>(["none", "parsed", "partial", "unparsed"]);
const INFO_KINDS = new Set<InfoKind>(["PERMISSION", "PROGRAM", "GRADE"]);

/** Throws unless `rule` is a well-formed Rule (PLAN.md §2.5). */
export function assertRule(rule: unknown, where = "rule"): asserts rule is Rule {
  const fail = (why: string): never => {
    throw new Error(`${where}: ${why}`);
  };
  if (typeof rule !== "object" || rule === null) fail("not an object");
  const r = rule as Record<string, unknown>;
  switch (r.kind) {
    case "AND":
    case "OR": {
      if (!Array.isArray(r.children) || r.children.length < 2) fail(`${r.kind} needs >= 2 children`);
      (r.children as unknown[]).forEach((c, i) => assertRule(c, `${where}.${i}`));
      return;
    }
    case "COURSE":
      if (typeof r.code !== "string" || !CODE.test(r.code)) fail(`bad course code ${String(r.code)}`);
      if (typeof r.concurrent !== "boolean") fail("concurrent must be boolean");
      return;
    case "UNITS":
      if (typeof r.min !== "number" || !(r.min > 0)) fail("UNITS min must be > 0");
      if (typeof r.concurrent !== "boolean") fail("concurrent must be boolean");
      if (r.subject !== undefined && typeof r.subject !== "string") fail("subject must be a string");
      if (r.levels !== undefined && !(Array.isArray(r.levels) && r.levels.every((l) => typeof l === "number")))
        fail("levels must be number[]");
      if (r.from !== undefined && !(Array.isArray(r.from) && r.from.every((c) => typeof c === "string" && CODE.test(c))))
        fail("from must be course codes");
      return;
    case "INFO":
      if (!INFO_KINDS.has(r.info as InfoKind)) fail(`bad info kind ${String(r.info)}`);
      if (typeof r.text !== "string" || r.text.length === 0) fail("INFO needs text");
      return;
    case "UNMODELLED":
      if (typeof r.text !== "string" || r.text.length === 0) fail("UNMODELLED needs text");
      return;
    default:
      fail(`unknown kind ${String(r.kind)}`);
  }
}

function assertCourse(c: FileCourse): void {
  const where = `catalogue course ${c.code}`;
  if (!CODE.test(c.code)) throw new Error(`${where}: bad code`);
  if (c.subject !== c.code.slice(0, 4) || c.number !== Number(c.code.slice(4)) || c.level !== Math.floor(c.number / 1000) * 1000)
    throw new Error(`${where}: subject/number/level disagree with the code`);
  if (!Number.isInteger(c.units) || c.units <= 0) throw new Error(`${where}: units must be a positive integer`);
  if (!Array.isArray(c.offered) || !c.offered.every((p) => PERIODS.has(p))) throw new Error(`${where}: bad offered`);
  if (!STATUSES.has(c.parseStatus)) throw new Error(`${where}: bad parseStatus`);
  if (!Array.isArray(c.incompatible) || !c.incompatible.every((x) => CODE.test(x))) throw new Error(`${where}: bad incompatible`);
  if (c.rule !== null) assertRule(c.rule, `${where} rule`);
}

export function readCatalogueIndex(dir: string): CatalogueIndexFile {
  return JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as CatalogueIndexFile;
}

/** index.json plus every subject file it lists, as one CatalogueFile. */
export function readCatalogueFile(dir: string, index = readCatalogueIndex(dir)): CatalogueFile {
  const courses: FileCourse[] = [];
  for (const { subject, count } of index.subjects) {
    const list = JSON.parse(readFileSync(join(dir, `${subject}.json`), "utf8")) as FileCourse[];
    if (list.length !== count) throw new Error(`catalogue/${subject}.json has ${list.length} courses, index says ${count}`);
    courses.push(...list);
  }
  return { ...index, courses };
}

function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

/**
 * One transaction: upsert every course in `file` with retired = 0, mark every
 * other course row retired = 1 (never delete: plan_entries references it),
 * record the version. Skips all writes when the stored version already
 * matches, unless `force`.
 */
export function syncCatalogue(db: DB, file: CatalogueFile, force = false): SyncReport {
  if (!force && getMeta(db, "catalogue_version") === file.version) {
    return { upserted: 0, retired: 0, version: file.version, changed: false };
  }
  for (const c of file.courses) assertCourse(c);

  const upsert = db.prepare(`
    INSERT INTO courses (code, subject, number, level, title, units, summary, description, offered_json,
      requisite_text, rule_json, parse_status, incompatible_json, origin, source_url, catalogue_year, retired)
    VALUES (@code, @subject, @number, @level, @title, @units, @summary, @description, @offered_json,
      @requisite_text, @rule_json, @parse_status, @incompatible_json, @origin, @source_url, @catalogue_year, 0)
    ON CONFLICT(code) DO UPDATE SET
      subject = excluded.subject, number = excluded.number, level = excluded.level, title = excluded.title,
      units = excluded.units, summary = excluded.summary, description = excluded.description,
      offered_json = excluded.offered_json, requisite_text = excluded.requisite_text, rule_json = excluded.rule_json,
      parse_status = excluded.parse_status, incompatible_json = excluded.incompatible_json, origin = excluded.origin,
      source_url = excluded.source_url, catalogue_year = excluded.catalogue_year, retired = 0`);
  const retire = db.prepare(
    "UPDATE courses SET retired = 1 WHERE retired = 0 AND code NOT IN (SELECT value FROM json_each(?))",
  );
  const setMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  return db.transaction((): SyncReport => {
    for (const c of file.courses) {
      upsert.run({
        code: c.code,
        subject: c.subject,
        number: c.number,
        level: c.level,
        title: c.title,
        units: c.units,
        summary: c.summary,
        description: c.description,
        offered_json: JSON.stringify(c.offered),
        requisite_text: c.requisiteText,
        rule_json: c.rule === null ? null : JSON.stringify(c.rule),
        parse_status: c.parseStatus,
        incompatible_json: JSON.stringify(c.incompatible),
        origin: c.origin,
        source_url: c.sourceUrl,
        catalogue_year: c.catalogueYear,
      });
    }
    const retired = retire.run(JSON.stringify(file.courses.map((c) => c.code))).changes;
    setMeta.run("catalogue_version", file.version);
    setMeta.run("catalogue_synced_at", new Date().toISOString());
    return { upserted: file.courses.length, retired, version: file.version, changed: true };
  })();
}

/** Reads index.json, and the subject files only when the version changed. */
export function syncCatalogueFromDir(db: DB, dir: string): { report: SyncReport; index: CatalogueIndexFile } {
  const index = readCatalogueIndex(dir);
  if (getMeta(db, "catalogue_version") === index.version) {
    return { report: { upserted: 0, retired: 0, version: index.version, changed: false }, index };
  }
  return { report: syncCatalogue(db, readCatalogueFile(dir, index)), index };
}

export function formatSyncReport(r: SyncReport): string {
  return r.changed
    ? `catalogue sync: ${r.upserted} upserted, ${r.retired} retired, version ${r.version} (changed)`
    : `catalogue sync: up to date (${r.version})`;
}

interface CourseRowRaw {
  code: string;
  subject: string;
  number: number;
  level: number;
  title: string;
  units: number;
  summary: string;
  offered_json: string;
  requisite_text: string | null;
  rule_json: string | null;
  parse_status: string;
  incompatible_json: string;
  origin: string;
  source_url: string;
  catalogue_year: number;
  retired: number;
}

/** Every course row (retired included, description excluded) as CatalogueCourse. */
export function loadCatalogueCourses(db: DB): CatalogueCourse[] {
  const rows = db
    .prepare(
      `SELECT code, subject, number, level, title, units, summary, offered_json, requisite_text, rule_json,
         parse_status, incompatible_json, origin, source_url, catalogue_year, retired FROM courses ORDER BY code`,
    )
    .all() as CourseRowRaw[];
  return rows.map((r) => {
    const rule = r.rule_json === null ? null : (JSON.parse(r.rule_json) as unknown);
    if (rule !== null) assertRule(rule, `courses.${r.code}.rule_json`);
    return {
      code: r.code,
      subject: r.subject,
      number: r.number,
      level: r.level,
      title: r.title,
      units: r.units,
      summary: r.summary,
      offered: JSON.parse(r.offered_json) as Period[],
      requisiteText: r.requisite_text,
      rule,
      parseStatus: r.parse_status as ParseStatus,
      incompatible: JSON.parse(r.incompatible_json) as string[],
      origin: r.origin as CatalogueCourse["origin"],
      sourceUrl: r.source_url,
      catalogueYear: r.catalogue_year,
      retired: r.retired === 1,
    };
  });
}

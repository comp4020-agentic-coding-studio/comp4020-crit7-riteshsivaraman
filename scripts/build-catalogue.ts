#!/usr/bin/env node
// Builds the committed catalogue (PLAN.md §2.5, §5.3 track A) from the
// scraper's extracted text:
//
//   node scripts/build-catalogue.ts             # catalogue/raw/*.json -> catalogue/
//   node scripts/build-catalogue.ts --fixture   # spec/fixtures/catalogue-mini.json -> catalogue/
//
// Real mode parses every requisite text with the engine's parseRequisiteText
// (track B), so it needs B's parser; until that lands, --fixture writes the
// Wave 0 fixture (v1's 8 courses) in the same on-disk shape so the server
// boots and the suite runs.
//
// Output: catalogue/<SUBJECT>.json ((CatalogueCourse & {description})[]
// sorted by code), catalogue/index.json (version = first 8 hex of sha256 over
// the subject files in index order), catalogue/report.json (totals,
// failures, parseStatus counts per subject, every partial/unparsed course
// with its text).
//
// Runs locally only; reads no process.env.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CatalogueFile, CatalogueIndexFile, ParseStatus, Period, Rule } from "../src/lib/contracts.ts";
import type { RawCourse, ScrapeMeta } from "./scrape-catalogue.ts";

type FileCourse = CatalogueFile["courses"][number];
type Parser = (raw: string) => { rule: Rule | null; incompatible: string[]; status: ParseStatus };

const OUT = "catalogue";
const RAW = join(OUT, "raw");
const CODE = /^[A-Z]{4}\d{4}$/;
const PERIOD_ORDER: Period[] = ["SUMMER", "S1", "AUTUMN", "WINTER", "S2", "SPRING"];

// Scope (Ritesh, 2026-09-30): the committed catalogue holds only these two
// colleges' courses, matched against the P&C page's verbatim "ANU College"
// field (never a subject-prefix guess). A joint course ("A / B") is in scope
// if either college is. Courses outside stay in catalogue/raw/ (the scrape
// covers every college); requisites naming them keep the plain code, which
// the engine treats as an unknown course.
export const COLLEGES = ["ANU College of Systems and Society", "ANU College of Business and Economics"];
export function inCollegeScope(college: string | null): boolean {
  return college !== null && college.split(" / ").some((c) => COLLEGES.includes(c.trim()));
}

/** "First Semester 2026" -> "S1". Quarters (online PG terms) aren't Periods: null. */
export function mapOffering(raw: string): Period | null {
  const s = raw.toLowerCase();
  if (/first semester/.test(s)) return "S1";
  if (/second semester/.test(s)) return "S2";
  if (/summer/.test(s)) return "SUMMER";
  if (/autumn/.test(s)) return "AUTUMN";
  if (/winter/.test(s)) return "WINTER";
  if (/spring/.test(s)) return "SPRING";
  return null;
}

/** <= 280 chars, whole sentences where possible. */
export function summarise(description: string, max = 280): string {
  const text = description.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    const next = (out + s).trim();
    if (next.length > max) break;
    out = `${next} `;
  }
  out = out.trim();
  if (out.length > 0) return out;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim()}…`;
}

function ruleCodes(rule: Rule | null, out: Set<string>): void {
  if (!rule) return;
  if (rule.kind === "AND" || rule.kind === "OR") for (const c of rule.children) ruleCodes(c, out);
  else if (rule.kind === "COURSE") out.add(rule.code);
  else if (rule.kind === "UNITS") for (const c of rule.from ?? []) out.add(c);
}

/** Codes a rule names (COURSE, UNITS.from) that the catalogue doesn't hold. */
function deadCodes(courses: FileCourse[]): { code: string; referencedBy: string[] }[] {
  const known = new Set(courses.map((c) => c.code));
  const dead = new Map<string, Set<string>>();
  for (const c of courses) {
    const refs = new Set<string>();
    ruleCodes(c.rule, refs);
    for (const ref of refs) {
      if (known.has(ref)) continue;
      if (!dead.has(ref)) dead.set(ref, new Set());
      dead.get(ref)?.add(c.code);
    }
  }
  return [...dead].map(([code, by]) => ({ code, referencedBy: [...by].sort() })).sort((a, b) => a.code.localeCompare(b.code));
}

function writeCatalogue(
  courses: FileCourse[],
  names: Map<string, string>,
  scrapedAt: string,
  source: string,
): CatalogueIndexFile {
  const bySubject = new Map<string, FileCourse[]>();
  for (const c of courses) {
    if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
    bySubject.get(c.subject)?.push(c);
  }
  const subjects = [...bySubject.keys()].sort();
  mkdirSync(OUT, { recursive: true });
  // a subject that vanished must not linger as a stale file
  for (const f of readdirSync(OUT)) {
    if (/^[A-Z]{4}\.json$/.test(f) && !bySubject.has(f.slice(0, 4))) rmSync(join(OUT, f));
  }
  const hash = createHash("sha256");
  for (const s of subjects) {
    const list = (bySubject.get(s) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    const text = `${JSON.stringify(list, null, 1)}\n`;
    writeFileSync(join(OUT, `${s}.json`), text);
    hash.update(text);
  }
  const index: CatalogueIndexFile = {
    version: hash.digest("hex").slice(0, 8),
    scrapedAt,
    source,
    subjects: subjects.map((s) => ({ subject: s, name: names.get(s) ?? s, count: bySubject.get(s)?.length ?? 0 })),
  };
  writeFileSync(join(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/** Makes `incompatible` symmetric among catalogue courses; sorted, deduped. */
export function symmetricIncompatible(courses: FileCourse[]): void {
  const byCode = new Map(courses.map((c) => [c.code, c]));
  const sets = new Map(courses.map((c) => [c.code, new Set(c.incompatible.filter((x) => x !== c.code))]));
  for (const c of courses) {
    for (const other of sets.get(c.code) ?? []) {
      if (byCode.has(other)) sets.get(other)?.add(c.code);
    }
  }
  for (const c of courses) c.incompatible = [...(sets.get(c.code) ?? [])].sort();
}

function buildFromFixture(): void {
  const fixture = JSON.parse(readFileSync("spec/fixtures/catalogue-mini.json", "utf8")) as CatalogueFile;
  const names = new Map(fixture.subjects.map((s) => [s.subject, s.name]));
  const index = writeCatalogue(fixture.courses.map((c) => ({ ...c })), names, fixture.scrapedAt, fixture.source);
  const report = {
    mode: "fixture",
    note: "Wave 0 fixture (v1's 8 courses), not a scrape. Replaced by a real build once parseRequisiteText lands.",
    version: index.version,
    listingTotal: fixture.courses.length,
    courseCount: fixture.courses.length,
    failures: [],
    notFound: [],
    deadCodes: deadCodes(fixture.courses),
    parseStatusBySubject: parseStatusBySubject(fixture.courses),
    needsReview: [],
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`catalogue (fixture): ${fixture.courses.length} courses, version ${index.version}`);
}

function parseStatusBySubject(courses: FileCourse[]): Record<string, Record<ParseStatus, number>> {
  const out: Record<string, Record<ParseStatus, number>> = {};
  for (const c of courses) {
    out[c.subject] ??= { none: 0, parsed: 0, partial: 0, unparsed: 0 };
    out[c.subject][c.parseStatus]++;
  }
  return out;
}

async function loadParser(): Promise<Parser> {
  // The engine is written for Astro/Vite, whose imports omit ".ts"; Node's
  // type stripping needs them, so resolve extensionless relative imports.
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (err) {
        if (!specifier.startsWith(".") || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
        for (const ext of [".ts", ".tsx", "/index.ts"]) {
          try {
            return next(specifier + ext, context);
          } catch {
            // try the next extension
          }
        }
        throw err;
      }
    },
  });
  const engine = (await import(pathToFileURL(join(process.cwd(), "src/lib/engine/index.ts")).href)) as {
    parseRequisiteText: Parser;
  };
  return engine.parseRequisiteText;
}

async function buildFromRaw(): Promise<void> {
  if (!existsSync(join(RAW, "_meta.json"))) throw new Error("no catalogue/raw/_meta.json --- run scripts/scrape-catalogue.ts first");
  const meta = JSON.parse(readFileSync(join(RAW, "_meta.json"), "utf8")) as ScrapeMeta;
  const raws: RawCourse[] = readdirSync(RAW)
    .filter((f) => /^[A-Z]{4}\.json$/.test(f))
    .flatMap((f) => JSON.parse(readFileSync(join(RAW, f), "utf8")) as RawCourse[]);
  const parse = await loadParser();

  const missingCollege = raws.filter((r) => r.college === undefined || r.college === null).map((r) => r.code);
  if (raws.length > 0 && missingCollege.length === raws.length) {
    throw new Error("catalogue/raw has no college field --- re-extract with scripts/scrape-catalogue.ts (cache only)");
  }
  const outOfScope = raws.filter((r) => !inCollegeScope(r.college));
  const outOfScopeCodes = new Set(outOfScope.map((r) => r.code));
  const inScopeRaws = raws.filter((r) => inCollegeScope(r.college));
  const collegeCounts: Record<string, number> = {};
  for (const r of raws) collegeCounts[r.college ?? "(none)"] = (collegeCounts[r.college ?? "(none)"] ?? 0) + 1;

  const excluded: { code: string; why: string }[] = [];
  const droppedOfferings: { code: string; raw: string }[] = [];
  const names = new Map<string, Map<string, number>>();
  const courses: FileCourse[] = [];
  for (const r of inScopeRaws) {
    if (!CODE.test(r.code)) {
      excluded.push({ code: r.code, why: "non-standard code" });
      continue;
    }
    if (r.units === null || !Number.isInteger(r.units) || r.units <= 0) {
      excluded.push({ code: r.code, why: `units not a positive integer: "${r.unitsText}"` });
      continue;
    }
    const offered: Period[] = [];
    for (const o of r.offeredRaw) {
      const p = mapOffering(o);
      if (p === null) droppedOfferings.push({ code: r.code, raw: o });
      else if (!offered.includes(p)) offered.push(p);
    }
    offered.sort((a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b));
    const parsed = r.requisiteText === null ? { rule: null, incompatible: [], status: "none" as const } : parse(r.requisiteText);
    const subject = r.code.slice(0, 4);
    if (r.subjectName) {
      const m = names.get(subject) ?? new Map<string, number>();
      m.set(r.subjectName, (m.get(r.subjectName) ?? 0) + 1);
      names.set(subject, m);
    }
    const number = Number(r.code.slice(4));
    courses.push({
      code: r.code,
      subject,
      number,
      level: Math.floor(number / 1000) * 1000,
      title: r.title,
      units: r.units,
      summary: summarise(r.description),
      offered,
      requisiteText: r.requisiteText,
      rule: parsed.rule,
      parseStatus: parsed.status,
      incompatible: parsed.incompatible,
      origin: r.origin,
      sourceUrl: r.sourceUrl,
      catalogueYear: r.catalogueYear,
      retired: false,
      description: r.description,
    });
  }
  symmetricIncompatible(courses);


  const subjectNames = new Map(
    [...names].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]] as const),
  );
  const index = writeCatalogue(courses, subjectNames, meta.scrapedAt, meta.source);

  // the listing total the catalogue answers to: listed courses in the two
  // colleges (+ any fetch failures, whose college is unknown)
  const listedInScope = inScopeRaws.filter((r) => r.origin === "catalogue").length + meta.failures.length;
  const dead = deadCodes(courses);
  const report = {
    mode: meta.scope === "all" ? "full" : "trial",
    scope: meta.scope,
    collegeFilter: {
      colleges: COLLEGES,
      rule: "course page's 'ANU College' field; a joint course is kept if either college matches",
      rawCourses: raws.length,
      keptCourses: courses.length,
      droppedOutsideColleges: outOfScope.length,
      rawByCollege: collegeCounts,
      missingCollegeField: missingCollege,
    },
    version: index.version,
    scrapedAt: meta.scrapedAt,
    listingEndpoint: meta.listingEndpoint,
    listingTotal: listedInScope,
    listingTotalAllSubjects: meta.listingTotal,
    catalogueCount: courses.filter((c) => c.origin === "catalogue").length,
    referencedCount: courses.filter((c) => c.origin === "referenced").length,
    courseCount: courses.length,
    failures: meta.failures,
    excluded,
    nonstandardCodesSkipped: meta.nonstandardCodes,
    notFound: meta.notFound,
    fellBackTo2025: meta.fellBackTo2025,
    // codes a rule names that were scraped but fall outside the two colleges
    outOfScopeCodes: dead.filter((d) => outOfScopeCodes.has(d.code)),
    // codes a rule names that exist nowhere in the scrape (404 in 2026 and 2025)
    deadCodes: dead.filter((d) => !outOfScopeCodes.has(d.code)),
    droppedOfferings,
    noDescription: courses.filter((c) => c.description === "").map((c) => c.code),
    parseStatusBySubject: parseStatusBySubject(courses),
    needsReview: courses
      .filter((c) => c.parseStatus === "partial" || c.parseStatus === "unparsed")
      .map((c) => ({ code: c.code, parseStatus: c.parseStatus, requisiteText: c.requisiteText })),
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  console.log(
    `catalogue: ${courses.length} courses (${report.referencedCount} referenced) of ${raws.length} scraped in CSS + CBE, ${excluded.length} excluded, ${report.outOfScopeCodes.length} out-of-scope + ${report.deadCodes.length} dead codes referenced, version ${index.version}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes("--fixture") ? Promise.resolve(buildFromFixture()) : buildFromRaw()).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

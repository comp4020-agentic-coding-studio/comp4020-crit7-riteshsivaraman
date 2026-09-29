import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogueFile, CatalogueIndexFile, Period, Rule } from "../src/lib/contracts";

// The committed catalogue (catalogue/*.json, built by scripts/build-catalogue.ts)
// is what every boot syncs into the DB, so it gets checked as data: shape,
// internal consistency, and agreement with the scrape report. PLAN.md §5.3 A.

type FileCourse = CatalogueFile["courses"][number];
interface Report {
  mode: "fixture" | "trial" | "full";
  version: string;
  listingTotal: number;
  failures: { code: string }[];
  excluded?: { code: string }[];
  notFound: { code: string }[];
  deadCodes: { code: string; referencedBy: string[] }[];
}

const read = (p: string) => readFileSync(new URL(`../catalogue/${p}`, import.meta.url), "utf8");
const index = JSON.parse(read("index.json")) as CatalogueIndexFile;
const subjectText = new Map(index.subjects.map((s) => [s.subject, read(`${s.subject}.json`)]));
const courses: FileCourse[] = [...subjectText.values()].flatMap((t) => JSON.parse(t) as FileCourse[]);
const byCode = new Map(courses.map((c) => [c.code, c]));
const report = JSON.parse(read("report.json")) as Report;

const PERIODS: Period[] = ["S1", "S2", "SUMMER", "WINTER", "AUTUMN", "SPRING"];

function ruleCodes(rule: Rule | null): string[] {
  if (!rule) return [];
  if (rule.kind === "AND" || rule.kind === "OR") return rule.children.flatMap(ruleCodes);
  if (rule.kind === "COURSE") return [rule.code];
  if (rule.kind === "UNITS") return rule.from ?? [];
  return [];
}

describe("committed catalogue", () => {
  it("version is the first 8 hex of sha256 over the subject files, and the report agrees", () => {
    const hash = createHash("sha256");
    for (const s of index.subjects) hash.update(subjectText.get(s.subject) ?? "");
    expect(index.version).toBe(hash.digest("hex").slice(0, 8));
    expect(report.version).toBe(index.version);
  });

  it("each subject file matches its index entry and is sorted by code", () => {
    for (const s of index.subjects) {
      const list = JSON.parse(subjectText.get(s.subject) ?? "[]") as FileCourse[];
      expect(list.length, s.subject).toBe(s.count);
      expect(list.every((c) => c.subject === s.subject)).toBe(true);
      expect(list.map((c) => c.code)).toEqual(list.map((c) => c.code).sort());
    }
    expect(new Set(courses.map((c) => c.code)).size).toBe(courses.length);
  });

  it("course count = listing total - reported failures, and failures stay <= 1%", () => {
    const listed = courses.filter((c) => c.origin === "catalogue").length;
    const lost = report.failures.length + (report.excluded?.length ?? 0);
    expect(listed).toBe(report.listingTotal - lost);
    expect(report.failures.length).toBeLessThanOrEqual(Math.ceil(report.listingTotal * 0.01));
  });

  it("every course has positive integer units and a level that matches its code", () => {
    const bad = courses.filter(
      (c) =>
        !Number.isInteger(c.units) ||
        c.units <= 0 ||
        c.subject !== c.code.slice(0, 4) ||
        c.number !== Number(c.code.slice(4)) ||
        c.level !== Math.floor(c.number / 1000) * 1000,
    );
    expect(bad.map((c) => c.code)).toEqual([]);
  });

  it("offerings are known periods and summaries are <= 280 chars", () => {
    const bad = courses.filter((c) => !c.offered.every((p) => PERIODS.includes(p)) || c.summary.length > 280);
    expect(bad.map((c) => c.code)).toEqual([]);
  });

  it("every COURSE / from code in a rule is in the catalogue or listed dead in the report", () => {
    const dead = new Set(report.deadCodes.map((d) => d.code));
    const missing = courses.flatMap((c) =>
      ruleCodes(c.rule)
        .filter((code) => !byCode.has(code) && !dead.has(code))
        .map((code) => `${c.code} -> ${code}`),
    );
    expect(missing).toEqual([]);
  });

  it("incompatibility is symmetric", () => {
    const oneWay = courses.flatMap((c) =>
      c.incompatible
        .filter((o) => byCode.has(o) && !byCode.get(o)?.incompatible.includes(c.code))
        .map((o) => `${c.code} -> ${o}`),
    );
    expect(oneWay).toEqual([]);
  });

  it("holds COMP1100 <-> COMP1130 and MATH1013", () => {
    expect(byCode.get("COMP1100")?.incompatible).toContain("COMP1130");
    expect(byCode.get("COMP1130")?.incompatible).toContain("COMP1100");
    expect(byCode.get("MATH1013")?.title.length).toBeGreaterThan(0);
  });
});

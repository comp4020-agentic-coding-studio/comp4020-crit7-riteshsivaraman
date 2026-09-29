import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogueFile, Period, Rule } from "../src/lib/contracts";

// Wave 0 sensor: spec/fixtures/catalogue-mini.json is what track A builds and
// tests against before the real catalogue exists, so it must actually have
// the CatalogueFile shape (PLAN.md §2.5). JSON imports widen literal unions to
// `string`, so the compiler can't check this --- this test does, at runtime.

const file = JSON.parse(
  readFileSync(new URL("./fixtures/catalogue-mini.json", import.meta.url), "utf8"),
) as CatalogueFile;

const PERIODS: Period[] = ["S1", "S2", "SUMMER", "WINTER", "AUTUMN", "SPRING"];
const CODE = /^[A-Z]{4}\d{4}$/;

function ruleProblems(rule: Rule, path: string): string[] {
  switch (rule.kind) {
    case "AND":
    case "OR":
      return rule.children.length < 2
        ? [`${path}: ${rule.kind} has ${rule.children.length} children`]
        : rule.children.flatMap((c, i) => ruleProblems(c, `${path}.${i}`));
    case "COURSE":
      return CODE.test(rule.code) && typeof rule.concurrent === "boolean" ? [] : [`${path}: bad COURSE`];
    case "UNITS":
      return rule.min > 0 && typeof rule.concurrent === "boolean" ? [] : [`${path}: bad UNITS`];
    case "INFO":
    case "UNMODELLED":
      return rule.text.length > 0 ? [] : [`${path}: empty text`];
    default:
      return [`${path}: unknown kind ${(rule as { kind: string }).kind}`];
  }
}

function hasUnmodelled(rule: Rule): boolean {
  if (rule.kind === "UNMODELLED") return true;
  return (rule.kind === "AND" || rule.kind === "OR") && rule.children.some(hasUnmodelled);
}

describe("catalogue-mini fixture matches the §2.5 contract", () => {
  it("has the index fields", () => {
    expect(file.version).toMatch(/^[0-9a-f]{8}$/);
    expect(Number.isNaN(Date.parse(file.scrapedAt))).toBe(false);
    expect(file.source).toMatch(/^https:\/\/programsandcourses\.anu\.edu\.au\//);
  });

  it("holds v1's eight courses, sorted by code", () => {
    const codes = file.courses.map((c) => c.code);
    expect(codes).toEqual([
      "COMP1100",
      "COMP1130",
      "COMP1140",
      "COMP1600",
      "COMP2100",
      "COMP3600",
      "MATH1013",
      "MATH1014",
    ]);
  });

  it("subject counts agree with the courses", () => {
    for (const s of file.subjects) {
      expect(file.courses.filter((c) => c.subject === s.subject)).toHaveLength(s.count);
    }
    expect(file.subjects.reduce((n, s) => n + s.count, 0)).toBe(file.courses.length);
  });

  it.each(file.courses.map((c) => [c.code, c] as const))("%s: derived fields and rule", (code, c) => {
    expect(c.subject).toBe(code.slice(0, 4));
    expect(c.number).toBe(Number(code.slice(4)));
    expect(c.level).toBe(Math.floor(c.number / 1000) * 1000);
    expect(c.units).toBeGreaterThan(0);
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.summary.length).toBeGreaterThan(0);
    expect(c.summary.length).toBeLessThanOrEqual(280);
    expect(c.description.length).toBeGreaterThanOrEqual(c.summary.length);
    for (const p of c.offered) expect(PERIODS).toContain(p);
    expect(c.sourceUrl).toBe(`https://programsandcourses.anu.edu.au/${c.catalogueYear}/course/${code}`);
    expect(c.origin).toBe("catalogue");
    expect(c.retired).toBe(false);
    for (const other of c.incompatible) expect(other).toMatch(CODE);

    if (c.requisiteText === null) expect(c.parseStatus).toBe("none");
    if (c.rule === null) {
      // incompatibility-only text is "parsed" (rule null); "none" only when text is absent
      expect(c.parseStatus).toBe(c.requisiteText === null ? "none" : "parsed");
    } else {
      expect(ruleProblems(c.rule, code)).toEqual([]);
      const expected = c.rule.kind === "UNMODELLED" ? "unparsed" : hasUnmodelled(c.rule) ? "partial" : "parsed";
      expect(c.parseStatus).toBe(expected);
    }
  });

  it("incompatibility is symmetric among the fixture's own courses", () => {
    const byCode = new Map(file.courses.map((c) => [c.code, c]));
    for (const c of file.courses) {
      for (const other of c.incompatible) {
        const o = byCode.get(other);
        if (o) expect(o.incompatible, `${other} should list ${c.code}`).toContain(c.code);
      }
    }
    expect(byCode.get("COMP1100")?.incompatible).toContain("COMP1130");
  });
});

describe("shared contract modules stay browser-safe", () => {
  it.each(["src/lib/contracts.ts", "src/lib/engine/index.ts", "src/components/graph/GraphView.tsx"])(
    "%s has no node: imports, DB imports or process.env",
    (path) => {
      const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/from\s+["']node:/);
      expect(src).not.toMatch(/from\s+["'][./]*(?:lib\/)?db["']/);
      expect(src).not.toMatch(/process\.env/);
    },
  );
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogueFile, ParseStatus, Rule } from "../src/lib/contracts";
import { parseRequisiteText } from "../src/lib/engine";

// Golden fixtures: every example quoted in REQUISITES.md §2, plus the full
// "Requisite and Incompatibility" text of 60 real 2026 P&C course pages
// (fetched 2026-09-30, COMP-heavy with MATH/ENGN/STAT/ECON/PHYS/LAWS/PSYC/...
// for prose outside CECC). Each expected Rule was read against the source
// text by hand; a change here is a parser behaviour change, not a refresh.

interface Case {
  id: string;
  source: string;
  text: string;
  expected: { status: ParseStatus; incompatible: string[]; rule: Rule | null };
}

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/requisite-texts.json", import.meta.url), "utf8"),
) as Case[];
const mini = JSON.parse(
  readFileSync(new URL("./fixtures/catalogue-mini.json", import.meta.url), "utf8"),
) as CatalogueFile;

function nodes(rule: Rule | null): Rule[] {
  if (!rule) return [];
  return rule.kind === "AND" || rule.kind === "OR" ? [rule, ...rule.children.flatMap(nodes)] : [rule];
}
const unmodelledTexts = (rule: Rule | null) =>
  nodes(rule).flatMap((n) => (n.kind === "UNMODELLED" ? [n.text] : []));

describe("golden fixtures (REQUISITES.md + real P&C text)", () => {
  it("has the REQUISITES.md examples and at least 20 real course texts", () => {
    expect(cases.filter((c) => c.source.startsWith("REQUISITES.md")).length).toBeGreaterThanOrEqual(14);
    expect(cases.filter((c) => c.source.startsWith("https://")).length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(parseRequisiteText(c.text)).toEqual({
      rule: c.expected.rule,
      incompatible: c.expected.incompatible,
      status: c.expected.status,
    });
  });
});

describe("catalogue-mini texts parse to the fixture's rules", () => {
  it.each(mini.courses.map((c) => [c.code, c] as const))("%s", (_, c) => {
    const parsed = parseRequisiteText(c.requisiteText ?? "");
    expect(parsed.rule).toEqual(c.rule);
    expect(parsed.status).toBe(c.parseStatus);
    expect(parsed.incompatible).toEqual(c.incompatible);
  });
});

describe("status", () => {
  it("is none for empty or whitespace text", () => {
    expect(parseRequisiteText("")).toEqual({ rule: null, incompatible: [], status: "none" });
    expect(parseRequisiteText("  \n ")).toEqual({ rule: null, incompatible: [], status: "none" });
  });

  it("is parsed with a null rule for incompatibility-only text", () => {
    expect(parseRequisiteText("Incompatible with COMP1130.")).toEqual({
      rule: null,
      incompatible: ["COMP1130"],
      status: "parsed",
    });
  });

  it("drops assumed knowledge and recommendations from the rule", () => {
    expect(parseRequisiteText("Assumed knowledge: MATH1013. It is recommended that students complete COMP1100.")).toEqual({
      rule: null,
      incompatible: [],
      status: "parsed",
    });
  });
});

describe("precedence", () => {
  const rule = (t: string) => parseRequisiteText(t).rule;
  const c = (code: string) => ({ kind: "COURSE", code, concurrent: false });

  it("plain lists: OR binds tighter than AND (P&C's 'A or B AND C')", () => {
    expect(rule("To enrol in this course you must have completed AAAA1000 or BBBB1000 and CCCC1000.")).toEqual({
      kind: "AND",
      children: [{ kind: "OR", children: [c("AAAA1000"), c("BBBB1000")] }, c("CCCC1000")],
    });
  });

  it("mixed case: the UPPERCASE connective is the top level", () => {
    expect(rule("To enrol in this course you must have completed AAAA1000 and BBBB1000 OR CCCC1000 and DDDD1000.")).toEqual({
      kind: "OR",
      children: [
        { kind: "AND", children: [c("AAAA1000"), c("BBBB1000")] },
        { kind: "AND", children: [c("CCCC1000"), c("DDDD1000")] },
      ],
    });
  });

  it("clauses (connective + verb): AND binds tighter than OR", () => {
    expect(
      rule("To enrol in this course you must be enrolled in the Master of Computing AND have completed AAAA1000 OR be enrolled in the Master of Data Science."),
    ).toEqual({
      kind: "OR",
      children: [
        { kind: "AND", children: [{ kind: "INFO", info: "PROGRAM", text: "Master of Computing" }, c("AAAA1000")] },
        { kind: "INFO", info: "PROGRAM", text: "Master of Data Science" },
      ],
    });
  });

  it("a sentence starting AND/OR joins the previous requirement at the top", () => {
    expect(rule("To enrol in this course you must have completed AAAA1000 or BBBB1000. AND CCCC1000.")).toEqual({
      kind: "AND",
      children: [{ kind: "OR", children: [c("AAAA1000"), c("BBBB1000")] }, c("CCCC1000")],
    });
  });
});

describe("never guess: an unrecognised clause stays UNMODELLED, verbatim", () => {
  it.each<[string, string, string]>([
    [
      "grade condition on a course",
      "To enrol in this course you must have completed COMP1100 with a grade of Credit or higher.",
      "To enrol in this course you must have completed COMP1100 with a grade of Credit or higher",
    ],
    [
      "grade words after a code are not a title",
      "To enrol in this course you must have completed COMP1100 Credit or higher.",
      "To enrol in this course you must have completed COMP1100 Credit or higher",
    ],
    ["'or equivalent'", "To enrol in this course you must have completed COMP2100 and MATH1013 or equivalent.", "MATH1013 or equivalent"],
    ["a process step", "To enrol in this course you must have completed COMP2100 and secure a project supervisor.", "secure a project supervisor"],
    [
      "a pooled count across two subjects",
      "To enrol in this course you must have completed 12 units of COMP or MATH courses.",
      "To enrol in this course you must have completed 12 units of COMP or MATH courses",
    ],
    [
      "an exclusion after a comma",
      "To enrol in this course you must have completed 6 units of 1000 level MATH, excluding MATH1003.",
      "To enrol in this course you must have completed 6 units of 1000 level MATH, excluding MATH1003",
    ],
    ["and/or between courses", "To enrol in this course you must have completed COMP1100 and/or COMP1110.", "To enrol in this course you must have completed COMP1100 and/or COMP1110"],
    ["no preamble and not a rule", "Completion of COMP1100 is strongly advised.", "Completion of COMP1100 is strongly advised"],
    [
      "a program exclusion is not a course incompatibility",
      "You are not able to enrol in this course if you are enrolled in the Master of Computing (Advanced).",
      "You are not able to enrol in this course if you are enrolled in the Master of Computing (Advanced)",
    ],
    [
      "a qualifier after a bare comma is not an alternative",
      "To enrol in this course you must be enrolled in the Bachelor of Computing (HCOMP) or Bachelor of Advanced Computing (AACOM), with 24 units of COMP-coded courses already passed.",
      "To enrol in this course you must be enrolled in the Bachelor of Computing (HCOMP) or Bachelor of Advanced Computing (AACOM), with 24 units of COMP-coded courses already passed",
    ],
    ["'them' concurrency is not guessed per course", "To enrol in this course you must have completed MATH1013 or MATH1115 or be doing them concurrently.", "be doing them concurrently"],
  ])("%s", (_, text, clause) => {
    const parsed = parseRequisiteText(text);
    expect(parsed.status).not.toBe("parsed");
    expect(unmodelledTexts(parsed.rule)).toContain(clause);
  });

  it("the pooled-subject count never becomes a single-subject UNITS node", () => {
    const parsed = parseRequisiteText("To enrol in this course you must have completed 12 units of COMP or MATH courses.");
    expect(nodes(parsed.rule).filter((n) => n.kind === "UNITS")).toEqual([]);
  });
});

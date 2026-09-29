import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogueCourse, CatalogueFile, Plan, PlanEntry, PlanPeriod, Rule } from "../src/lib/contracts";
import {
  dependentsOf,
  describeRule,
  evaluatePlan,
  firstFreeSlot,
  indexCatalogue,
  parseRequisiteText,
  previewPlacement,
  termOrder,
} from "../src/lib/engine";

// Engine semantics, one block per rule in PLAN.md §3.1 "Evaluation
// semantics". Pure: no DB, no server. Synthetic courses keep each case about
// one rule; catalogue-mini carries the v1 cases forward (the old isSatisfied
// tests), so v1 behaviour is pinned on the new engine before v1 is deleted.

const mini = JSON.parse(
  readFileSync(new URL("./fixtures/catalogue-mini.json", import.meta.url), "utf8"),
) as CatalogueFile;

function course(code: string, over: Partial<CatalogueCourse> = {}): CatalogueCourse {
  const number = Number(code.slice(4));
  return {
    code,
    subject: code.slice(0, 4),
    number,
    level: Math.floor(number / 1000) * 1000,
    title: code,
    units: 6,
    summary: "",
    offered: ["S1", "S2", "SUMMER"],
    requisiteText: null,
    rule: null,
    parseStatus: "none",
    incompatible: [],
    origin: "catalogue",
    sourceUrl: `https://programsandcourses.anu.edu.au/2026/course/${code}`,
    catalogueYear: 2026,
    retired: false,
    ...over,
  };
}

const C = (code: string, concurrent = false): Rule => ({ kind: "COURSE", code, concurrent });
const U = (min: number, extra: Partial<Extract<Rule, { kind: "UNITS" }>> = {}): Rule => ({
  kind: "UNITS",
  min,
  concurrent: false,
  ...extra,
});

// Placement helper: [code, year, period]
type At = [string, number, PlanPeriod];
function plan(...at: At[]): Plan {
  const entries: PlanEntry[] = at.map(([code, year, period], i) => ({ id: i + 1, code, year, period, slot: 0 }));
  return { years: 3, summerYears: [1, 2], entries };
}

/** Status of the entry for `code` in a plan built from `at`. */
function statusOf(courses: CatalogueCourse[], code: string, ...at: At[]) {
  const p = plan(...at);
  const evaluation = evaluatePlan(p, indexCatalogue(courses, "test"));
  const entry = p.entries.find((e) => e.code === code)!;
  return evaluation.entries[entry.id]!;
}

describe("termOrder", () => {
  it("orders Y1S1 < Y1S2 < Y1SUMMER < Y2S1 < Y2S2", () => {
    const order = [termOrder(1, "S1"), termOrder(1, "S2"), termOrder(1, "SUMMER"), termOrder(2, "S1"), termOrder(2, "S2")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("firstFreeSlot", () => {
  it("is 0 in an empty term and the lowest gap otherwise", () => {
    expect(firstFreeSlot(plan(), 1, "S1")).toBe(0);
    const p: Plan = {
      years: 3,
      summerYears: [],
      entries: [
        { id: 1, code: "A", year: 1, period: "S1", slot: 0 },
        { id: 2, code: "B", year: 1, period: "S1", slot: 2 },
        { id: 3, code: "C", year: 1, period: "S2", slot: 1 },
      ],
    };
    expect(firstFreeSlot(p, 1, "S1")).toBe(1);
    expect(firstFreeSlot(p, 1, "S2")).toBe(0);
    expect(firstFreeSlot(p, 2, "S1")).toBe(0);
  });

  it("is null when the term is full (4 slots in a semester, 2 in summer)", () => {
    const entries = (period: PlanPeriod, n: number): PlanEntry[] =>
      Array.from({ length: n }, (_, slot) => ({ id: slot + 1, code: `X${slot}`, year: 1, period, slot }));
    expect(firstFreeSlot({ years: 1, summerYears: [], entries: entries("S1", 4) }, 1, "S1")).toBeNull();
    expect(firstFreeSlot({ years: 1, summerYears: [], entries: entries("S1", 3) }, 1, "S1")).toBe(3);
    expect(firstFreeSlot({ years: 1, summerYears: [1], entries: entries("SUMMER", 2) }, 1, "SUMMER")).toBeNull();
  });
});

describe("COURSE", () => {
  const needsA = (concurrent: boolean) => [course("AAAA1000"), course("BBBB2000", { rule: C("AAAA1000", concurrent) })];

  it.each<[string, At, "ok" | "violation"]>([
    ["strictly earlier: met", ["AAAA1000", 1, "S1"], "ok"],
    ["same term: unmet", ["AAAA1000", 1, "S2"], "violation"],
    ["later term: unmet", ["AAAA1000", 2, "S1"], "violation"],
  ])("non-concurrent, %s", (_, at, state) => {
    expect(statusOf(needsA(false), "BBBB2000", at, ["BBBB2000", 1, "S2"]).state).toBe(state);
  });

  it.each<[string, At, "ok" | "violation"]>([
    ["strictly earlier: met", ["AAAA1000", 1, "S1"], "ok"],
    ["same term: met (corequisite)", ["AAAA1000", 1, "S2"], "ok"],
    ["later term: unmet", ["AAAA1000", 2, "S1"], "violation"],
  ])("concurrent, %s", (_, at, state) => {
    expect(statusOf(needsA(true), "BBBB2000", at, ["BBBB2000", 1, "S2"]).state).toBe(state);
  });

  it("not planned at all: a MISSING_REQUISITE error naming the course", () => {
    const s = statusOf(needsA(false), "BBBB2000", ["BBBB2000", 1, "S2"]);
    expect(s.issues[0]).toMatchObject({ kind: "MISSING_REQUISITE", short: "Needs AAAA1000 first", missing: C("AAAA1000") });
  });
});

describe("summer ordering", () => {
  const cat = [course("AAAA1000"), course("BBBB2000", { rule: C("AAAA1000") })];
  it("a Y1 summer course is before Y2S1", () => {
    expect(statusOf(cat, "BBBB2000", ["AAAA1000", 1, "SUMMER"], ["BBBB2000", 2, "S1"]).state).toBe("ok");
  });
  it("a Y1 summer course is after Y1S2", () => {
    expect(statusOf(cat, "BBBB2000", ["AAAA1000", 1, "SUMMER"], ["BBBB2000", 1, "S2"]).state).toBe("violation");
  });
});

describe("UNITS", () => {
  const pool = [
    course("COMP1100"),
    course("COMP2100"),
    course("COMP2300"),
    course("COMP3600"),
    course("MATH2301"),
    course("COMP2400", { units: 12 }),
  ];

  it("subject-only counts every level of that subject and nothing else", () => {
    const cat = [...pool, course("COMP4000", { rule: U(12, { subject: "COMP" }) })];
    expect(statusOf(cat, "COMP4000", ["COMP1100", 1, "S1"], ["MATH2301", 1, "S1"], ["COMP4000", 2, "S1"]).state).toBe("violation");
    expect(statusOf(cat, "COMP4000", ["COMP1100", 1, "S1"], ["COMP3600", 1, "S1"], ["COMP4000", 2, "S1"]).state).toBe("ok");
  });

  it("level-scoped ignores other levels and other subjects", () => {
    const cat = [...pool, course("COMP3900", { rule: U(12, { subject: "COMP", levels: [2000] }) })];
    // 6 units of 2000-level COMP + 1000-level COMP + 3000-level COMP + 2000-level MATH = still 6
    expect(
      statusOf(cat, "COMP3900", ["COMP2100", 1, "S1"], ["COMP1100", 1, "S1"], ["COMP3600", 1, "S1"], ["MATH2301", 1, "S1"], ["COMP3900", 2, "S1"]).state,
    ).toBe("violation");
    expect(statusOf(cat, "COMP3900", ["COMP2100", 1, "S1"], ["COMP2300", 1, "S2"], ["COMP3900", 2, "S1"]).state).toBe("ok");
  });

  it("several levels count together; no subject means any subject", () => {
    const cat = [...pool, course("ZZZZ4000", { rule: U(12, { levels: [2000, 3000] }) })];
    expect(statusOf(cat, "ZZZZ4000", ["MATH2301", 1, "S1"], ["COMP3600", 1, "S1"], ["ZZZZ4000", 2, "S1"]).state).toBe("ok");
    expect(statusOf(cat, "ZZZZ4000", ["MATH2301", 1, "S1"], ["COMP1100", 1, "S1"], ["ZZZZ4000", 2, "S1"]).state).toBe("violation");
  });

  it("uses each course's own units", () => {
    const cat = [...pool, course("COMP3999", { rule: U(12, { subject: "COMP", levels: [2000] }) })];
    expect(statusOf(cat, "COMP3999", ["COMP2400", 1, "S1"], ["COMP3999", 2, "S1"]).state).toBe("ok");
  });

  it("`from` counts only the listed courses, ignoring subject/levels", () => {
    const cat = [...pool, course("COMP4610", { rule: U(6, { from: ["COMP3600", "MATH2301"], subject: "COMP", levels: [2000] }) })];
    expect(statusOf(cat, "COMP4610", ["COMP2100", 1, "S1"], ["COMP2300", 1, "S1"], ["COMP4610", 2, "S1"]).state).toBe("violation");
    expect(statusOf(cat, "COMP4610", ["MATH2301", 1, "S1"], ["COMP4610", 2, "S1"]).state).toBe("ok");
  });

  it("same-term courses count only when concurrent", () => {
    const strict = [...pool, course("COMP4001", { rule: U(6, { subject: "COMP" }) })];
    const conc = [...pool, course("COMP4001", { rule: U(6, { subject: "COMP", concurrent: true }) })];
    expect(statusOf(strict, "COMP4001", ["COMP1100", 2, "S1"], ["COMP4001", 2, "S1"]).state).toBe("violation");
    expect(statusOf(conc, "COMP4001", ["COMP1100", 2, "S1"], ["COMP4001", 2, "S1"]).state).toBe("ok");
    expect(statusOf(conc, "COMP4001", ["COMP1100", 2, "S2"], ["COMP4001", 2, "S1"]).state).toBe("violation");
  });

  it("a course never counts toward its own requisite", () => {
    // COMP2999 is itself 6 units of 2000-level COMP; concurrent would otherwise let it count itself
    const cat = [course("COMP2999", { rule: U(6, { subject: "COMP", levels: [2000], concurrent: true }) })];
    expect(statusOf(cat, "COMP2999", ["COMP2999", 1, "S1"]).state).toBe("violation");
    const listed = [course("COMP2998", { rule: U(6, { from: ["COMP2998"], concurrent: true }) })];
    expect(statusOf(listed, "COMP2998", ["COMP2998", 1, "S1"]).state).toBe("violation");
  });

  it("nor does a second entry of the same course (a retake) in an earlier term", () => {
    const cat = [course("COMP2997", { rule: U(6, { subject: "COMP" }) })];
    const p = plan(["COMP2997", 1, "S1"], ["COMP2997", 2, "S1"]);
    const later = evaluatePlan(p, indexCatalogue(cat, "t")).entries[2]!;
    expect(later.state).toBe("violation");
  });
});

describe("tri-state AND / OR", () => {
  // met = a course planned earlier, unmet = one never planned, unknown = UNMODELLED
  const leaf = { met: C("MMMM1000"), unmet: C("NNNN1000"), unknown: { kind: "UNMODELLED", text: "x" } as Rule };
  type S = keyof typeof leaf;
  const states: S[] = ["met", "unmet", "unknown"];
  const AND: Record<string, S> = {
    "met,met": "met", "met,unmet": "unmet", "met,unknown": "unknown",
    "unmet,met": "unmet", "unmet,unmet": "unmet", "unmet,unknown": "unmet",
    "unknown,met": "unknown", "unknown,unmet": "unmet", "unknown,unknown": "unknown",
  };
  const OR: Record<string, S> = {
    "met,met": "met", "met,unmet": "met", "met,unknown": "met",
    "unmet,met": "met", "unmet,unmet": "unmet", "unmet,unknown": "unknown",
    "unknown,met": "met", "unknown,unmet": "unknown", "unknown,unknown": "unknown",
  };
  const pairs = states.flatMap((a) => states.map((b) => [a, b] as [S, S]));

  for (const [kind, table] of [["AND", AND], ["OR", OR]] as const) {
    it.each(pairs)(`${kind}(%s, %s)`, (a, b) => {
      const cat = [course("MMMM1000"), course("TTTT2000", { rule: { kind, children: [leaf[a], leaf[b]] } })];
      const s = statusOf(cat, "TTTT2000", ["MMMM1000", 1, "S1"], ["TTTT2000", 2, "S1"]);
      expect(s.clauses!.state).toBe(table[`${a},${b}`]);
    });
  }
});

describe("INFO and UNMODELLED", () => {
  const info: Rule = { kind: "INFO", info: "PERMISSION", text: "You will need to request a permission code" };
  const un: Rule = { kind: "UNMODELLED", text: "find a project/supervisor" };

  it("INFO evaluates met, adds an info issue, and never makes the entry a violation", () => {
    const s = statusOf([course("PPPP3000", { rule: info })], "PPPP3000", ["PPPP3000", 1, "S1"]);
    expect(s.clauses!.state).toBe("met");
    expect(s.state).toBe("ok");
    expect(s.issues).toEqual([
      { kind: "INFO", severity: "info", short: "Permission code may be needed", info: "PERMISSION", text: info.text },
    ]);
  });


  it("UNMODELLED is unknown: a warning with the verbatim text, never an error", () => {
    const s = statusOf([course("QQQQ3000", { rule: un })], "QQQQ3000", ["QQQQ3000", 1, "S1"]);
    expect(s.clauses!.state).toBe("unknown");
    expect(s.state).toBe("warning");
    expect(s.issues).toEqual([{ kind: "UNMODELLED", severity: "warning", short: "Check official requisites", text: un.text }]);
  });

  it("a root that is unknown because of one clause is a warning even with the rest met", () => {
    const cat = [course("MMMM1000"), course("QQQQ3000", { rule: { kind: "AND", children: [C("MMMM1000"), un] } })];
    const s = statusOf(cat, "QQQQ3000", ["MMMM1000", 1, "S1"], ["QQQQ3000", 2, "S1"]);
    expect(s.state).toBe("warning");
    expect(s.issues.map((i) => i.kind)).toEqual(["UNMODELLED"]);
  });
});

describe("OR satisfiable only via an INFO branch (amber warning)", () => {
  const texts = JSON.parse(readFileSync(new URL("./fixtures/requisite-texts.json", import.meta.url), "utf8")) as {
    id: string;
    expected: { rule: Rule | null; incompatible: string[] };
  }[];
  const ruleOf = (id: string) => texts.find((t) => t.id === id)!.expected.rule!;
  const program: Rule = { kind: "INFO", info: "PROGRAM", text: "Bachelor of Computing (Honours) (HCOMP)", programs: ["HCOMP"] };
  const orRule: Rule = { kind: "OR", children: [C("COMP2100"), program] };
  const unverified = (s: { issues: { kind: string }[] }) => s.issues.filter((i) => i.kind === "UNVERIFIED_REQUISITE");

  it("checkable branch unmet: a warning (not ok, not an error) naming both alternatives", () => {
    const s = statusOf([course("COMP2100"), course("PPPP3000", { rule: orRule })], "PPPP3000", ["PPPP3000", 1, "S1"]);
    expect(s.clauses!.state).toBe("unknown");
    expect(s.state).toBe("warning");
    expect(s.issues[0]).toEqual({
      kind: "UNVERIFIED_REQUISITE",
      severity: "warning",
      short: "Needs COMP2100 or program HCOMP",
      missing: orRule,
      detail: "None of the checkable options is in the plan: COMP2100. It can only be met by enrolment in HCOMP (not checked).",
    });
    expect(s.issues[0]!.short.length).toBeLessThanOrEqual(32);
  });

  it("checkable branch met: the OR is met exactly as before (ok, info note only)", () => {
    const s = statusOf([course("COMP2100"), course("PPPP3000", { rule: orRule })], "PPPP3000", ["COMP2100", 1, "S1"], ["PPPP3000", 2, "S1"]);
    expect(s.clauses!.state).toBe("met");
    expect(s.state).toBe("ok");
    expect(s.issues.map((i) => i.kind)).toEqual(["INFO"]);
  });

  it("COMP4450: no COMP units is a warning; 24 COMP units meets it", () => {
    const cat = [course("COMP4450", { rule: ruleOf("COMP4450") }), ...["COMP1100", "COMP1110", "COMP2100", "COMP2120"].map((c) => course(c))];
    const none = statusOf(cat, "COMP4450", ["COMP4450", 3, "S1"]);
    expect(none.state).toBe("warning");
    expect(unverified(none)).toHaveLength(1);
    expect(none.issues[0]).toMatchObject({ kind: "UNVERIFIED_REQUISITE", short: "Needs 24 COMP units or a program" });
    expect((none.issues[0] as { detail: string }).detail).toBe(
      "None of the checkable options is in the plan: (enrolment in AACOM (not checked) and 24 units of COMP courses). " +
        "It can only be met by enrolment in HCOMP, HADAN or COMP-HSPC (not checked).",
    );
    const enough = statusOf(cat, "COMP4450", ["COMP1100", 1, "S1"], ["COMP1110", 1, "S2"], ["COMP2100", 2, "S1"], ["COMP2120", 2, "S1"], ["COMP4450", 3, "S1"]);
    expect(enough.state).toBe("ok");
    expect(unverified(enough)).toEqual([]);
  });

  it("COMP6442: none of the course paths is a warning; COMP1110 + MATH1005 meets it", () => {
    const cat = [course("COMP6442", { rule: ruleOf("COMP6442") }), course("COMP1110"), course("MATH1005")];
    const none = statusOf(cat, "COMP6442", ["COMP6442", 2, "S1"]);
    expect(none.state).toBe("warning");
    expect(none.issues[0]).toMatchObject({ kind: "UNVERIFIED_REQUISITE", short: "Needs requisites or a program" });
    const detail = (none.issues[0] as { detail: string }).detail;
    expect(detail).toContain("COMP6710, COMP7710, COMP1110 or COMP1140");
    expect(detail).toContain("It can only be met by program enrolment: “Master of Computing (Advanced)” (not checked).");
    const met = statusOf(cat, "COMP6442", ["COMP1110", 1, "S1"], ["MATH1005", 1, "S1"], ["COMP6442", 2, "S1"]);
    expect(met.state).toBe("ok");
    // MMLCV branch: its checkable half met, so the OR is met via that branch (info note only)
    const mmlcv = statusOf(cat, "COMP6442", ["COMP1110", 1, "S1"], ["COMP6442", 2, "S1"]);
    expect(mmlcv.state).toBe("ok");
  });

  it("AND(unverified OR, unmet course): red error for the course part, amber for the OR", () => {
    const rule: Rule = { kind: "AND", children: [orRule, C("COMP1600")] };
    const cat = [course("COMP2100"), course("COMP1600"), course("PPPP3000", { rule })];
    const s = statusOf(cat, "PPPP3000", ["PPPP3000", 1, "S1"]);
    expect(s.state).toBe("violation");
    expect(s.issues[0]).toMatchObject({ kind: "MISSING_REQUISITE", short: "Needs COMP1600 first", missing: C("COMP1600") });
    expect(s.issues.map((i) => i.kind)).toEqual(["MISSING_REQUISITE", "UNVERIFIED_REQUISITE", "INFO"]);
    // the course part met: only the amber warning is left
    const half = statusOf(cat, "PPPP3000", ["COMP1600", 1, "S1"], ["PPPP3000", 2, "S1"]);
    expect(half.state).toBe("warning");
    expect(half.issues.map((i) => i.kind)).toEqual(["UNVERIFIED_REQUISITE", "INFO"]);
  });

  it("nested OR(OR(COMP2100, program), COMP1600) flattens into one warning naming both courses", () => {
    const rule: Rule = { kind: "OR", children: [orRule, C("COMP1600")] };
    const cat = [course("COMP2100"), course("COMP1600"), course("PPPP3000", { rule })];
    const s = statusOf(cat, "PPPP3000", ["PPPP3000", 1, "S1"]);
    expect(s.state).toBe("warning");
    expect(unverified(s)).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ short: "Needs requisites or a program" });
    expect((s.issues[0] as { detail: string }).detail).toBe(
      "None of the checkable options is in the plan: COMP2100 or COMP1600. It can only be met by enrolment in HCOMP (not checked).",
    );
    expect(statusOf(cat, "PPPP3000", ["COMP1600", 1, "S1"], ["PPPP3000", 2, "S1"]).state).toBe("ok");
  });

  it("a lone INFO and an all-INFO OR keep the plain info behaviour", () => {
    const allInfo: Rule = { kind: "OR", children: [program, { kind: "INFO", info: "PERMISSION", text: "permission code" }] };
    const s = statusOf([course("PPPP3000", { rule: allInfo })], "PPPP3000", ["PPPP3000", 1, "S1"]);
    expect(s.clauses!.state).toBe("met");
    expect(s.state).toBe("ok");
    expect(s.issues.every((i) => i.kind === "INFO")).toBe(true);
  });
});

describe("incompatibility", () => {
  const cat = [course("COMP1100", { incompatible: ["COMP1130"] }), course("COMP1130", { incompatible: ["COMP1100"] })];

  it.each<[string, At]>([
    ["earlier term", ["COMP1130", 1, "S1"]],
    ["same term", ["COMP1130", 2, "S1"]],
    ["later term", ["COMP1130", 3, "S2"]],
  ])("errors when the other course is in an %s", (_, at) => {
    const s = statusOf(cat, "COMP1100", ["COMP1100", 2, "S1"], at);
    expect(s.state).toBe("violation");
    expect(s.issues[0]).toMatchObject({ kind: "INCOMPATIBLE", with: "COMP1130", short: "Incompatible with COMP1130" });
  });

  it("is fine when the other course is not planned", () => {
    expect(statusOf(cat, "COMP1100", ["COMP1100", 1, "S1"]).state).toBe("ok");
  });
});

describe("offerings and retired courses", () => {
  it("NOT_OFFERED when offered lacks the period", () => {
    const s = statusOf([course("SSSS1000", { offered: ["S1"] })], "SSSS1000", ["SSSS1000", 1, "S2"]);
    expect(s.state).toBe("warning");
    expect(s.issues).toEqual([{ kind: "NOT_OFFERED", severity: "warning", short: "Not offered in S2", period: "S2" }]);
  });

  it("NO_OFFERING_LISTED when offered is empty", () => {
    const s = statusOf([course("SSSS1000", { offered: [] })], "SSSS1000", ["SSSS1000", 1, "S1"]);
    expect(s.issues).toEqual([{ kind: "NO_OFFERING_LISTED", severity: "warning", short: "No 2026 offering listed" }]);
  });

  it("RETIRED for a retired course and for a code the index doesn't know", () => {
    expect(statusOf([course("RRRR1000", { retired: true })], "RRRR1000", ["RRRR1000", 1, "S1"]).issues[0]!.kind).toBe("RETIRED");
    const s = statusOf([], "GONE1000", ["GONE1000", 1, "S1"]);
    expect(s).toMatchObject({ state: "warning", clauses: null });
    expect(s.issues.map((i) => i.kind)).toEqual(["RETIRED"]);
  });
});

describe("issue ordering and short strings", () => {
  const long = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555"];
  const cat = [
    course("WORS3000", {
      offered: ["S1"],
      incompatible: ["AAAA1111"],
      rule: {
        kind: "AND",
        children: [
          { kind: "OR", children: long.map((c) => C(c)) },
          U(12, { subject: "COMP", levels: [3000, 4000] }),
          { kind: "INFO", info: "GRADE", text: "a WAM of 70", wam: 70 },
          { kind: "UNMODELLED", text: "find a supervisor" },
        ],
      },
    }),
    course("AAAA1111"),
  ];

  it("sorts error, warning, info", () => {
    const s = statusOf(cat, "WORS3000", ["WORS3000", 1, "S2"], ["AAAA1111", 2, "S1"]);
    const rank = { error: 0, warning: 1, info: 2 };
    const sev = s.issues.map((i) => rank[i.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(new Set(s.issues.map((i) => i.severity))).toEqual(new Set(["error", "warning", "info"]));
    expect(s.state).toBe("violation");
  });

  it("every short is at most 32 characters", () => {
    const s = statusOf(cat, "WORS3000", ["WORS3000", 1, "S2"], ["AAAA1111", 2, "S1"]);
    for (const i of s.issues) expect(i.short.length, i.short).toBeLessThanOrEqual(32);
    // and for each real fixture rule left entirely unmet
    const texts = JSON.parse(readFileSync(new URL("./fixtures/requisite-texts.json", import.meta.url), "utf8")) as {
      expected: { rule: Rule | null };
    }[];
    for (const t of texts) {
      if (!t.expected.rule) continue;
      const st = statusOf([course("TEST9999", { rule: t.expected.rule, offered: [] })], "TEST9999", ["TEST9999", 1, "S1"]);
      for (const i of st.issues) expect(i.short.length, i.short).toBeLessThanOrEqual(32);
    }
  });
});

describe("evaluatePlan totals", () => {
  it("sums units per term (every plan term present), total, problems and version", () => {
    const cat = indexCatalogue(
      [course("AAAA1000"), course("BBBB2000", { units: 12, rule: C("AAAA1000") }), course("CCCC1000", { units: 6 })],
      "abcd1234",
    );
    const p = plan(["AAAA1000", 1, "S1"], ["BBBB2000", 1, "S1"], ["CCCC1000", 1, "SUMMER"]);
    const ev = evaluatePlan(p, cat);
    // BBBB2000 is 12u, so it is split over Y1 S1 and Y1 S2 (spec/footprint.test.ts)
    expect(ev.unitsByTerm).toMatchObject({ "Y1-S1": 12, "Y1-S2": 6, "Y1-SUMMER": 6, "Y2-S1": 0, "Y3-S2": 0 });
    expect(Object.keys(ev.unitsByTerm)).toHaveLength(8); // 3 years x 2 + summers in Y1, Y2
    expect(ev.totalUnits).toBe(24);
    expect(ev.problemCount).toBe(1); // BBBB2000 same term as its requisite
    expect(ev.catalogueVersion).toBe("abcd1234");
  });
});

describe("previewPlacement", () => {
  const cat = indexCatalogue([course("AAAA1000"), course("BBBB2000", { rule: C("AAAA1000") })], "v");

  it("previews the course's own status at the target term", () => {
    const p = plan(["AAAA1000", 1, "S2"]);
    expect(previewPlacement("BBBB2000", 1, "S2", p, cat).state).toBe("violation");
    expect(previewPlacement("BBBB2000", 2, "S1", p, cat)).toEqual({ state: "ok", issues: [] });
  });

  it("previewing a move: the course's current entry never counts toward itself", () => {
    const units = indexCatalogue([course("COMP3001", { rule: U(6, { subject: "COMP" }) })], "v");
    const p = plan(["COMP3001", 1, "S1"]);
    expect(previewPlacement("COMP3001", 2, "S1", p, units).state).toBe("violation");
  });
});

describe("v1 behaviour on catalogue-mini (ported isSatisfied cases)", () => {
  const courses = mini.courses;
  it("COMP1100 has no requisites", () => {
    expect(statusOf(courses, "COMP1100", ["COMP1100", 1, "S1"]).state).toBe("ok");
  });
  it("COMP1140 needs COMP1130 in an earlier term", () => {
    expect(statusOf(courses, "COMP1140", ["COMP1140", 1, "S2"]).state).toBe("violation");
    expect(statusOf(courses, "COMP1140", ["COMP1130", 1, "S1"], ["COMP1140", 1, "S2"]).state).toBe("ok");
  });
  it("COMP2100 needs (COMP1110 or COMP1140) and 6 units of 1000-level MATH", () => {
    expect(statusOf(courses, "COMP2100", ["COMP1140", 1, "S2"], ["COMP2100", 2, "S1"]).state).toBe("violation");
    expect(statusOf(courses, "COMP2100", ["COMP1140", 1, "S2"], ["MATH1013", 1, "S1"], ["COMP2100", 2, "S1"]).state).toBe("ok");
  });
  it("COMP1100 and COMP1130 clash wherever they are", () => {
    const s = statusOf(courses, "COMP1130", ["COMP1100", 1, "S1"], ["COMP1130", 3, "S1"]);
    expect(s.issues.map((i) => i.kind)).toContain("INCOMPATIBLE");
  });
});

describe("dependentsOf", () => {
  const cat = indexCatalogue(
    [...mini.courses, course("COMP4610", { rule: { kind: "AND", children: [C("COMP2100"), U(6, { from: ["COMP3600"] })] } })],
    mini.version,
  );
  it("lists courses whose rule names the code, sorted", () => {
    expect(dependentsOf("COMP1130", cat)).toEqual(["COMP1140", "COMP1600"]);
    expect(dependentsOf("COMP1100", cat)).toEqual(["COMP1600"]);
  });
  it("includes UNITS `from` references and handles unknown codes", () => {
    expect(dependentsOf("COMP3600", cat)).toEqual(["COMP4610"]);
    expect(dependentsOf("NOPE0000", cat)).toEqual([]);
  });
  it("works for an index assembled without indexCatalogue", () => {
    const hand = { byCode: new Map(mini.courses.map((c) => [c.code, c] as const)), version: "x" };
    expect(dependentsOf("MATH1013", hand)).toEqual(["MATH1014"]);
  });
});

describe("describeRule", () => {
  const cat = indexCatalogue(mini.courses, mini.version);
  const texts = JSON.parse(readFileSync(new URL("./fixtures/requisite-texts.json", import.meta.url), "utf8")) as {
    id: string;
    text: string;
  }[];
  const english = (id: string) => describeRule(parseRequisiteText(texts.find((t) => t.id === id)!.text).rule!, cat);

  it("COMP2100", () => {
    expect(english("COMP2100")).toBe("(COMP1110 or COMP1140) and 6 units of 1000-level MATH courses");
  });
  it("COMP2120 (corequisite)", () => {
    expect(english("COMP2120")).toBe("COMP2100 (completed or same term)");
  });
  it("COMP2700 (level-scoped, REQUISITES.md fragment) and COMP3900", () => {
    expect(english("COMP2700-fragment")).toBe("12 units of 2000-level COMP courses");
    expect(english("COMP3900")).toBe("12 units of 2000-level COMP courses");
    expect(english("COMP4620")).toMatch(/^12 units of 3000- or 4000-level COMP courses, /);
  });
  it("COMP4610 (from a named list)", () => {
    expect(english("COMP4610")).toBe("COMP2100 and 6 units from COMP3600, COMP3540, COMP3900 or COMP3320");
  });
  it("COMP4450 (PROGRAM + UNITS)", () => {
    expect(english("COMP4450")).toBe(
      "enrolment in HCOMP, HADAN or COMP-HSPC (not checked) or (enrolment in AACOM (not checked) and 24 units of COMP courses)",
    );
  });
  it("renders codes the catalogue index doesn't know as plain codes", () => {
    const empty = indexCatalogue([], "empty");
    expect(describeRule({ kind: "OR", children: [C("ZZZZ9999"), C("COMP1100", true)] }, empty)).toBe(
      "ZZZZ9999 or COMP1100 (completed or same term)",
    );
    expect(describeRule(U(24), empty)).toBe("24 units of any courses");
  });
});

describe("engine purity", () => {
  const dir = new URL("../src/lib/engine/", import.meta.url);
  it.each(readdirSync(dir).filter((f) => f.endsWith(".ts")))(
    "src/lib/engine/%s imports nothing from node:*, db.ts or process.env",
    (file) => {
      const src = readFileSync(new URL(file, dir), "utf8");
      expect(src).not.toMatch(/from\s+["']node:/);
      expect(src).not.toMatch(/from\s+["'][./]*(?:lib\/)?db["']/);
      expect(src).not.toMatch(/process\.env/);
    },
  );
});

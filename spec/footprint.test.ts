import { describe, expect, it } from "vitest";
import type { CatalogueCourse, Plan, PlanEntry } from "../src/lib/contracts";
import { cellsOf, evaluatePlan, firstFreeSlot, fits, indexCatalogue, loadOf, type Load } from "../src/lib/engine/index";

// Multi-slot, multi-term courses (annual courses and courses over 6 units).
// Pure: no server. The HTTP side is in plan-api.test.ts.

const L = (units: number, annual = false): Load => ({ units, annual });
const plan = (entries: PlanEntry[], years = 3, summerYears: number[] = []): Plan => ({ years, summerYears, entries });
const e = (id: number, code: string, year: number, period: PlanEntry["period"], slot: number): PlanEntry => ({ id, code, year, period, slot });

describe("loadOf", () => {
  it("reads ANU's annual-course wording from the summary", () => {
    expect(loadOf({ units: 6, summary: "COMP3770 is an Annual course (6+6) that must be completed twice, in consecutive semesters." })).toEqual(L(6, true));
    expect(loadOf({ units: 6, summary: "COMP4500 is an annual course that must be completed twice, in consecutive semesters." })).toEqual(L(6, true));
    expect(loadOf({ units: 6, summary: "Introductory programming." })).toEqual(L(6, false));
  });
});

describe("cellsOf", () => {
  it("a 6u course is one cell", () => {
    expect(cellsOf({ year: 1, period: "S1", slot: 2 }, L(6))).toEqual([{ year: 1, period: "S1", slot: 2 }]);
  });
  it("an annual 6+6 course takes the same slot in S1 and S2", () => {
    expect(cellsOf({ year: 3, period: "S1", slot: 1 }, L(6, true))).toEqual([
      { year: 3, period: "S1", slot: 1 },
      { year: 3, period: "S2", slot: 1 },
    ]);
  });
  it("an annual 12+12 course takes two slots in each semester", () => {
    expect(cellsOf({ year: 4, period: "S1", slot: 0 }, L(12, true))).toHaveLength(4);
  });
  it("a plain 12u course is split: one slot in each of two semesters; 24u takes two in each", () => {
    expect(cellsOf({ year: 1, period: "S1", slot: 0 }, L(12))).toEqual([
      { year: 1, period: "S1", slot: 0 },
      { year: 1, period: "S2", slot: 0 },
    ]);
    expect(cellsOf({ year: 1, period: "S1", slot: 0 }, L(24)).map((c) => `${c.period}${c.slot}`)).toEqual(["S10", "S11", "S20", "S21"]);
  });
  it("starting in S2 continues into S1 of the next year", () => {
    expect(cellsOf({ year: 2, period: "S2", slot: 3 }, L(6, true))[1]).toEqual({ year: 3, period: "S1", slot: 3 });
  });
});

describe("fits", () => {
  it("rejects when the continuation cell is taken, naming the blocker", () => {
    const p = plan([e(1, "COMP1600", 1, "S2", 0)]);
    const f = fits(p, { year: 1, period: "S1", slot: 0 }, L(6, true), () => L(6));
    expect(f).toMatchObject({ ok: false, reason: "taken", cell: { year: 1, period: "S2", slot: 0 }, by: { code: "COMP1600" } });
  });
  it("rejects when the course would run past the last year or the last slot", () => {
    expect(fits(plan([], 3), { year: 3, period: "S2", slot: 0 }, L(6, true))).toMatchObject({ ok: false, reason: "outside" });
    expect(fits(plan([]), { year: 1, period: "S1", slot: 3 }, L(24))).toMatchObject({ ok: false, reason: "outside" });
  });
  it("a 6u course in the continuation cell of an annual course is blocked", () => {
    const p = plan([e(1, "COMP3770", 1, "S1", 0)]);
    const loads = (c: string) => (c === "COMP3770" ? L(6, true) : L(6));
    expect(fits(p, { year: 1, period: "S2", slot: 0 }, L(6), loads)).toMatchObject({ ok: false, by: { code: "COMP3770" } });
    expect(firstFreeSlot(p, 1, "S2", L(6), loads)).toBe(1);
  });
  it("moving a course ignores its own cells", () => {
    const p = plan([e(1, "COMP3770", 1, "S1", 0)]);
    const loads = () => L(6, true);
    expect(fits(p, { year: 1, period: "S1", slot: 0 }, L(6, true), loads, 1).ok).toBe(true);
    expect(fits(p, { year: 1, period: "S1", slot: 0 }, L(6, true), loads).ok).toBe(false);
  });
});

describe("evaluatePlan with a two-term course", () => {
  const course = (code: string, extra: Partial<CatalogueCourse> = {}): CatalogueCourse => ({
    code, subject: code.slice(0, 4), number: Number(code.slice(4)), level: Number(code[4]) * 1000, title: code,
    units: 6, offered: ["S1", "S2"], rule: null, requisiteText: "", summary: "", description: "",
    parseStatus: "none", incompatible: [], origin: "catalogue", sourceUrl: "", catalogueYear: 2026, retired: false,
    ...extra,
  } as CatalogueCourse);
  const cat = indexCatalogue([
    course("COMP3770", { summary: "COMP3770 is an Annual course (6+6) that must be completed twice, in consecutive semesters." }),
    course("COMP3999", { rule: { kind: "COURSE", code: "COMP3770", concurrent: false } }),
  ], "t");

  it("splits units over both terms", () => {
    const ev = evaluatePlan(plan([e(1, "COMP3770", 1, "S1", 0)]), cat);
    expect(ev.unitsByTerm["Y1-S1"]).toBe(6);
    expect(ev.unitsByTerm["Y1-S2"]).toBe(6);
    expect(ev.totalUnits).toBe(12);
  });

  it("counts as completed only after its second term", () => {
    const during = evaluatePlan(plan([e(1, "COMP3770", 1, "S1", 0), e(2, "COMP3999", 1, "S2", 1)]), cat);
    expect(during.entries[2].state).toBe("violation");
    const after = evaluatePlan(plan([e(1, "COMP3770", 1, "S1", 0), e(2, "COMP3999", 2, "S1", 1)]), cat);
    expect(after.entries[2].state).toBe("ok");
  });
});

describe("inCareer", () => {
  it("1000-4000 undergraduate, 6000+ postgraduate, 5000 exchange placeholders both", async () => {
    const { inCareer } = await import("../src/lib/career");
    expect([1000, 4000, 5000, 6000, 9000].map((l) => inCareer(l, "ug"))).toEqual([true, true, true, false, false]);
    expect([1000, 4000, 5000, 6000, 9000].map((l) => inCareer(l, "pg"))).toEqual([false, false, true, true, true]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";
import type { CatalogueCourse, CatalogueFile, Plan, PlacementPreview, SearchResult } from "../src/lib/contracts";
import { searchCourses } from "../src/lib/course-search";
import { termOrder } from "../src/lib/engine/index";

// Course search (PLAN.md §3.2): the ranking as pure unit tests (fixture +
// synthetic courses, a stub preview), then the HTTP contract against the
// built server.

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/catalogue-mini.json", import.meta.url), "utf8"),
) as CatalogueFile;
const FIXTURE: CatalogueCourse[] = fixture.courses.map(({ description: _d, ...c }) => c);
const EMPTY: Plan = { years: 3, summerYears: [], entries: [] };
const ok: PlacementPreview = { state: "ok", issues: [] };
const bad: PlacementPreview = { state: "violation", issues: [] };

function course(code: string, title: string, extra: Partial<CatalogueCourse> = {}): CatalogueCourse {
  const number = Number(code.slice(4));
  return {
    code,
    subject: code.slice(0, 4),
    number,
    level: Math.floor(number / 1000) * 1000,
    title,
    units: 6,
    summary: "",
    offered: ["S1", "S2"],
    requisiteText: null,
    rule: null,
    parseStatus: "none",
    incompatible: [],
    origin: "catalogue",
    sourceUrl: "",
    catalogueYear: 2026,
    retired: false,
    ...extra,
  };
}

const codes = (r: SearchResult[]) => r.map((x) => x.course.code);
const S1 = { year: 1, period: "S1" as const };

describe("ranking", () => {
  const list = [
    course("COMP3000", "Paralgorithmic Thinking"), // title contains "algo"
    course("COMP2000", "Algorithms"), // title word prefix
    course("ALGO2000", "Unrelated Title"), // code prefix, level 2000
    course("ALGO1000", "Unrelated Title"), // code prefix, level 1000
    course("MATH1000", "Calculus"), // subject name "Mathematics"
  ];
  const names = new Map([["MATH", "Mathematics"]]);

  it("orders exact code, code prefix, subject name, title word prefix, title contains", () => {
    const r = searchCourses(list, "algo", { plan: EMPTY, term: null, limit: 20, preview: () => ok, subjectNames: names });
    expect(codes(r)).toEqual(["ALGO1000", "ALGO2000", "COMP2000", "COMP3000"]);
    const exact = searchCourses(list, "algo2000", { plan: EMPTY, term: null, limit: 20, preview: () => ok });
    expect(codes(exact)[0]).toBe("ALGO2000");
    const byName = searchCourses(list, "mathem", { plan: EMPTY, term: null, limit: 20, preview: () => ok, subjectNames: names });
    expect(codes(byName)).toEqual(["MATH1000"]);
  });

  it("matches a bare number against the code's number ('1100' finds COMP1100)", () => {
    const r = searchCourses(FIXTURE, "1100", { plan: EMPTY, term: null, limit: 8, preview: () => ok });
    expect(codes(r)).toEqual(["COMP1100"]);
  });

  it("ties: Ready first when there is a term, then level, then code", () => {
    const preview = (code: string) => (code === "ALGO2000" ? ok : bad);
    const r = searchCourses(list, "algo", { plan: EMPTY, term: S1, limit: 20, preview });
    expect(codes(r).slice(0, 2)).toEqual(["ALGO2000", "ALGO1000"]);
    // without a term the Ready tie-break is dropped
    const noTerm = searchCourses(list, "algo", { plan: EMPTY, term: null, limit: 20, preview });
    expect(codes(noTerm).slice(0, 2)).toEqual(["ALGO1000", "ALGO2000"]);
  });

  it("'MATH' returns MATH courses, ahead of other subjects that only mention maths in the title", () => {
    const more = [...FIXTURE, course("MATH2320", "Linear Algebra"), course("PHYS1101", "Mathematical Physics")];
    const r = searchCourses(more, "MATH", { plan: EMPTY, term: null, limit: 8, preview: () => ok });
    expect(codes(r)).toEqual(["MATH1013", "MATH1014", "MATH2320", "PHYS1101"]);
  });

  it("never offers a retired course, and honours the limit", () => {
    const withRetired = [...list, course("ALGO1001", "Gone", { retired: true })];
    const r = searchCourses(withRetired, "algo", { plan: EMPTY, term: null, limit: 2, preview: () => ok });
    expect(codes(r)).toEqual(["ALGO1000", "ALGO2000"]);
  });

  it("reports where a result already sits in the plan", () => {
    const plan: Plan = { ...EMPTY, entries: [{ id: 7, code: "COMP1100", year: 2, period: "S2", slot: 1 }] };
    const r = searchCourses(FIXTURE, "COMP1100", { plan, term: S1, limit: 8, preview: () => ok });
    expect(r[0].inPlan).toBe("Y2-S2");
  });
});

describe("empty query suggestions", () => {
  it("with a term: only Ready + offered-this-period courses from COMP when the plan is empty, lowest level first", () => {
    // stub: courses without a rule are Ready
    const preview = (code: string) => (FIXTURE.find((c) => c.code === code)?.rule ? bad : ok);
    const r = searchCourses(FIXTURE, "", { plan: EMPTY, term: { year: 1, period: "S2" }, limit: 8, preview });
    // COMP1100 (S1,S2; ready) yes; COMP1130 S1 only: no; COMP1140/1600/2100/3600 have rules: not Ready; MATH: other subject
    expect(codes(r)).toEqual(["COMP1100"]);
    expect(r.every((x) => x.preview?.state === "ok")).toBe(true);
  });

  it("with a term: suggestions come from the plan's subjects, excluding planned courses", () => {
    const plan: Plan = { ...EMPTY, entries: [{ id: 1, code: "MATH1013", year: 1, period: "S1", slot: 0 }] };
    const r = searchCourses(FIXTURE, "", { plan, term: { year: 1, period: "S2" }, limit: 8, preview: () => ok });
    expect(codes(r)).toEqual(["MATH1014"]);
  });

  it("without a term: every preview is null, and suggestions are unplanned courses of the plan's subjects by level", () => {
    const plan: Plan = { ...EMPTY, entries: [{ id: 1, code: "COMP1100", year: 1, period: "S1", slot: 0 }] };
    const r = searchCourses(FIXTURE, "", { plan, term: null, limit: 8, preview: () => ok });
    expect(codes(r)).toEqual(["COMP1130", "COMP1140", "COMP1600", "COMP2100", "COMP3600"]);
    expect(r.every((x) => x.preview === null)).toBe(true);
  });
});

// --- HTTP -----------------------------------------------------------------

const ENGINE_READY = (() => {
  try {
    termOrder(1, "S1");
    return true;
  } catch {
    return false;
  }
})();

describe("GET /api/courses/search validation (no engine needed)", () => {
  const base = inject("baseUrl");
  it.each(["year=1", "period=S1", "year=1&period=WINTER", "year=9&period=S1", "limit=21", "limit=0", "limit=x", "career=phd"])(
    "400 INVALID for ?%s",
    async (qs) => {
      const res = await fetch(`${base}/api/courses/search?q=comp&${qs}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID");
    },
  );
});

describe.skipIf(!ENGINE_READY)("GET /api/courses/search (needs the engine)", () => {
  const base = inject("baseUrl");
  async function jar(): Promise<string> {
    const res = await fetch(`${base}/`);
    const c = res.headers.getSetCookie().find((x) => x.startsWith("dp_plan=")) ?? "";
    return c.split(";")[0];
  }
  const search = async (cookie: string, qs: string) =>
    (await (await fetch(`${base}/api/courses/search?${qs}`, { headers: { cookie } })).json()) as { results: SearchResult[] };

  it("career=ug returns only 1000-4000 level courses, career=pg only 5000+", async () => {
    const cookie = await jar();
    const ug = (await search(cookie, "q=COMP&limit=20&career=ug")).results.map((r) => r.course.level);
    const pg = (await search(cookie, "q=COMP&limit=20&career=pg")).results.map((r) => r.course.level);
    expect(ug.length).toBeGreaterThan(0);
    expect(pg.length).toBeGreaterThan(0);
    expect(ug.every((l) => l < 5000)).toBe(true);
    expect(pg.every((l) => l >= 5000)).toBe(true);
  });

  it("previews are per cookie: same query, different plans, different previews", async () => {
    const a = await jar();
    const b = await jar();
    const add = await fetch(`${base}/api/plan/entries`, {
      method: "POST",
      headers: { cookie: b, "content-type": "application/json" },
      body: JSON.stringify({ code: "COMP1130", year: 1, period: "S1", slot: 0 }),
    });
    expect(add.status).toBe(201);
    const pa = (await search(a, "q=COMP1100&year=1&period=S2")).results.find((r) => r.course.code === "COMP1100");
    const pb = (await search(b, "q=COMP1100&year=1&period=S2")).results.find((r) => r.course.code === "COMP1100");
    expect(pa?.preview?.state).toBe("ok");
    expect(pb?.preview?.state).toBe("violation"); // incompatible with the planned COMP1130
  });

  it("without year/period every preview is null; results carry no description", async () => {
    const r = await search(await jar(), "q=comp");
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.preview === null)).toBe(true);
    expect(r.results.every((x) => !("description" in x.course))).toBe(true);
  });
});

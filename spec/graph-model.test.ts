import { readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";
import { buildGraph, courseSentence, layoutColumns, neighbourhood, pickerTerms, type GraphModel } from "../src/components/graph/model";
import type { CatalogueCourse, CatalogueFile, Plan, PlannerState } from "../src/lib/contracts";
import { evaluatePlan, indexCatalogue } from "../src/lib/engine";

// PLAN.md §5.3 "E graph": the pure graph model. Pinned against the mini
// catalogue (v1's 8 courses) plus a few synthetic courses for the rule kinds
// the fixture lacks (corequisite, `from` list, a dependents-only course).

const mini = JSON.parse(readFileSync("spec/fixtures/catalogue-mini.json", "utf8")) as CatalogueFile;
const synth = (code: string, rule: CatalogueCourse["rule"], extra: Partial<CatalogueCourse> = {}): CatalogueCourse => ({
  code, subject: code.slice(0, 4), number: Number(code.slice(4)), level: Number(code[4]) * 1000,
  title: code, units: 6, summary: "", offered: ["S1", "S2"], requisiteText: null, rule,
  parseStatus: rule ? "parsed" : "none", incompatible: [], origin: "catalogue", sourceUrl: "",
  catalogueYear: 2026, retired: false, ...extra,
});
const extras: CatalogueCourse[] = [
  synth("COMP2120", { kind: "COURSE", code: "COMP2100", concurrent: true }),
  synth("COMP4610", { kind: "UNITS", min: 6, from: ["COMP3600", "COMP2100"], concurrent: false }),
  synth("COMP3900", { kind: "OR", children: [
    { kind: "AND", children: [{ kind: "COURSE", code: "COMP2100", concurrent: false }, { kind: "COURSE", code: "COMP1600", concurrent: false }] },
    { kind: "COURSE", code: "COMP3600", concurrent: false },
  ] }),
  synth("COMP1110", { kind: "COURSE", code: "COMP1100", concurrent: false }, { incompatible: ["COMP1140"] }),
];
const cat = indexCatalogue([...mini.courses, ...extras], mini.version);

function stateFor(codes: [string, number, "S1" | "S2" | "SUMMER"][], plan: Partial<Plan> = {}): PlannerState {
  const p: Plan = {
    years: 3, summerYears: [],
    entries: codes.map(([code, year, period], i) => ({ id: i + 1, code, year, period, slot: i % 4 })),
    ...plan,
  };
  return { plan: p, evaluation: evaluatePlan(p, cat) };
}
const node = (m: GraphModel, id: string) => m.nodes.find((n) => n.id === id);
const into = (m: GraphModel, target: string) => m.edges.filter((e) => e.target === target);

describe("graph model: rule shapes", () => {
  const m = buildGraph(cat, stateFor([["COMP2100", 2, "S1"]]));

  it("OR -> one hub, n in-edges, one out-edge to the course", () => {
    const hubs = m.nodes.filter((n) => n.kind === "or");
    expect(hubs).toHaveLength(1);
    const hub = hubs[0];
    expect(into(m, hub.id).map((e) => e.source).sort()).toEqual(["COMP1110", "COMP1140"]);
    expect(m.edges.filter((e) => e.source === hub.id).map((e) => e.target)).toEqual(["COMP2100"]);
  });

  it("AND -> separate direct edges into the course, no AND hub", () => {
    expect(m.nodes.some((n) => n.kind === "and")).toBe(false);
    // COMP2100 = AND(OR(..), UNITS): two arrows arrive at the course itself
    expect(into(m, "COMP2100")).toHaveLength(2);
  });

  it("an AND that is one alternative of an OR gets its own ALL hub", () => {
    const g = buildGraph(cat, stateFor([["COMP3900", 3, "S1"]]));
    const and = g.nodes.filter((n) => n.kind === "and");
    expect(and).toHaveLength(1);
    expect(into(g, and[0].id).map((e) => e.source).sort()).toEqual(["COMP1600", "COMP2100"]);
    const or = g.nodes.find((n) => n.kind === "or")!;
    expect(into(g, or.id).map((e) => e.source).sort()).toEqual([and[0].id, "COMP3600"].sort());
  });

  it("UNITS -> a units hub with its label", () => {
    const units = m.nodes.filter((n) => n.kind === "units");
    expect(units.map((u) => u.label)).toEqual(["6u · 1000-level MATH"]);
    expect(into(m, "COMP2100").some((e) => e.source === units[0].id)).toBe(true);
  });

  it("concurrent COURSE -> a coreq edge", () => {
    const g = buildGraph(cat, stateFor([["COMP2120", 2, "S1"]]));
    expect(into(g, "COMP2120").map((e) => [e.source, e.kind])).toEqual([["COMP2100", "coreq"]]);
  });

  it("`from` list members point into the units hub", () => {
    const g = buildGraph(cat, stateFor([["COMP4610", 3, "S1"]]));
    const hub = g.nodes.find((n) => n.kind === "units")!;
    expect(hub.label).toBe("6u from 2 courses");
    expect(into(g, hub.id).map((e) => e.source).sort()).toEqual(["COMP2100", "COMP3600"]);
  });
});

describe("graph model: incompatibility", () => {
  it("exactly one undirected edge per pair, even though both courses list it", () => {
    const g = buildGraph(cat, stateFor([["COMP1100", 1, "S1"], ["COMP1130", 1, "S2"]]));
    const inc = g.edges.filter((e) => e.kind === "incompatible");
    expect(inc).toHaveLength(1);
    expect([inc[0].source, inc[0].target].sort()).toEqual(["COMP1100", "COMP1130"]);
    expect(inc[0].clash).toBe(true);
  });

  it("a planned course's incompatible is drawn as a ghost with a non-clash edge", () => {
    const g = buildGraph(cat, stateFor([["COMP1100", 1, "S1"]]));
    expect(node(g, "COMP1130")).toMatchObject({ planned: false, kind: "course" });
    const inc = g.edges.filter((e) => e.kind === "incompatible");
    expect(inc).toHaveLength(1);
    expect(inc[0].clash).toBe(false);
  });

  it("undergraduate view skips postgraduate incompatible ghosts; postgraduate view skips undergraduate ones", () => {
    const st = stateFor([["COMP2100", 2, "S1"]]); // incompatible with COMP6442
    expect(node(buildGraph(cat, st, { career: "ug" }), "COMP6442")).toBeUndefined();
    expect(node(buildGraph(cat, st, { career: "pg" }), "COMP6442")).toMatchObject({ planned: false });
    expect(node(buildGraph(cat, st), "COMP6442")).toBeDefined(); // no career: unchanged
    // requisite ghosts are never filtered
    expect(node(buildGraph(cat, st, { career: "pg" }), "COMP1110")).toBeDefined();
  });

  describe("with incompatible ghosts hidden", () => {
    const hide = { incompatibleGhosts: false };

    it("drops ghosts that are only there because they are incompatible, and their edges", () => {
      const g = buildGraph(cat, stateFor([["COMP2100", 2, "S1"]]), hide);
      const ghosts = g.nodes.filter((n) => n.kind === "course" && !n.planned).map((n) => n.id).sort();
      // COMP6442 was only an incompatible; COMP1110/COMP1140 are requisites and stay
      expect(ghosts).toEqual(["COMP1110", "COMP1140"]);
      expect(g.edges.filter((e) => e.kind === "incompatible")).toHaveLength(0);
    });

    it("keeps a clash between two planned courses", () => {
      const g = buildGraph(cat, stateFor([["COMP1100", 1, "S1"], ["COMP1130", 1, "S2"]]), hide);
      const inc = g.edges.filter((e) => e.kind === "incompatible");
      expect(inc).toHaveLength(1);
      expect(inc[0].clash).toBe(true);
    });

    it("keeps an incompatible edge to a ghost that is also a missing requisite", () => {
      // COMP1110 needs COMP1100 (a requisite ghost) and is incompatible with COMP1140,
      // which COMP2100's rule also references: both ghosts stay, so the edge stays.
      const g = buildGraph(cat, stateFor([["COMP1110", 1, "S2"], ["COMP2100", 2, "S1"]]), hide);
      expect(node(g, "COMP1140")).toMatchObject({ planned: false });
      expect(g.edges.some((e) => e.kind === "incompatible" && [e.source, e.target].includes("COMP1140"))).toBe(true);
    });
  });
});

describe("graph model: scope", () => {
  it("planned = full nodes; referenced + incompatible unplanned = ghosts; nothing else", () => {
    const g = buildGraph(cat, stateFor([["COMP2100", 2, "S1"]]));
    const courses = g.nodes.filter((n) => n.kind === "course");
    expect(courses.filter((n) => n.planned).map((n) => n.id)).toEqual(["COMP2100"]);
    // COMP1110/COMP1140 referenced by the rule; COMP6442 incompatible with it
    expect(courses.filter((n) => !n.planned).map((n) => n.id).sort()).toEqual(["COMP1110", "COMP1140", "COMP6442"]);
    // COMP2120 and COMP4610 depend on COMP2100 but are not in the plan: absent
    expect(node(g, "COMP2120")).toBeUndefined();
    expect(node(g, "COMP4610")).toBeUndefined();
  });
});

describe("graph model: edge state", () => {
  it("an OR branch goes idle once the OR is met by another branch", () => {
    // COMP1600: AND(UNITS MATH, OR(COMP1100, COMP1130)); plan COMP1100 first.
    const g = buildGraph(cat, stateFor([["COMP1100", 1, "S1"], ["COMP1600", 1, "S2"]]));
    const hub = g.nodes.find((n) => n.kind === "or")!;
    const branch = (code: string) => g.edges.find((e) => e.source === code && e.target === hub.id)!;
    expect(branch("COMP1100").state).toBe("met");
    expect(branch("COMP1130").state).toBe("idle");
  });

  it("an unmet OR paints every branch red", () => {
    const g = buildGraph(cat, stateFor([["COMP1600", 1, "S2"]]));
    const hub = g.nodes.find((n) => n.kind === "or")!;
    expect(into(g, hub.id).map((e) => e.state)).toEqual(["unmet", "unmet"]);
  });
});

describe("graph model: layered layouts", () => {
  it("by semester: planned courses in their term's column, a requisite ghost one column before, hubs half a column before their owner", () => {
    const st = stateFor([["COMP1100", 1, "S1"], ["COMP2100", 2, "S1"]]);
    const g = buildGraph(cat, st);
    const { col, labels } = layoutColumns(g, st.plan, "semester");
    expect(col.get("COMP1100")).toBe(0); // Y1 S1
    expect(col.get("COMP2100")).toBe(2); // Y2 S1 (Y1 S2 is column 1)
    expect(labels.get(2)).toBe("Y2 S1");
    expect(col.get("COMP1110")).toBe(1); // feeds COMP2100 through its OR hub
    const or = g.nodes.find((n) => n.kind === "or")!;
    expect(col.get(or.id)).toBe(1.5);
  });

  it("by semester: an incompatible-only ghost sits beside its planned partner", () => {
    const st = stateFor([["COMP1100", 1, "S2"]]);
    const { col } = layoutColumns(buildGraph(cat, st), st.plan, "semester");
    expect(col.get("COMP1130")).toBe(1);
  });

  it("by level: one column per thousand", () => {
    const st = stateFor([["COMP1100", 1, "S1"], ["COMP2100", 2, "S1"]]);
    const { col, labels } = layoutColumns(buildGraph(cat, st), st.plan, "level");
    expect([col.get("COMP1100"), col.get("COMP2100")]).toEqual([0, 1]);
    expect(labels.get(1)).toBe("2000-level");
  });
});

describe("graph model: neighbourhood", () => {
  it("walks through hubs to requisites and dependents, plus clashes", () => {
    const g = buildGraph(cat, stateFor([["COMP1100", 1, "S1"], ["COMP1600", 1, "S2"], ["COMP1130", 1, "S1"]]));
    const nb = neighbourhood(g, "COMP1100");
    expect(nb.nodes.has("COMP1600")).toBe(true); // via the OR hub
    expect(nb.nodes.has("COMP1130")).toBe(true); // clash
    expect([...nb.nodes].some((id) => id.startsWith("units:"))).toBe(false); // sibling requisite, not a neighbour
  });
});

describe("SemesterPicker terms", () => {
  it("marks full terms disabled, and for a move the entry's own term", () => {
    const s = stateFor(
      [["COMP1100", 1, "S1"], ["COMP1130", 1, "S1"], ["MATH1013", 1, "S1"], ["COMP1600", 1, "S1"], ["COMP2100", 2, "S1"]],
      { summerYears: [1] },
    );
    const terms = pickerTerms(s.plan);
    expect(terms.map((t) => t.label)).toEqual(["Y1 S1", "Y1 S2", "Y1 Summer", "Y2 S1", "Y2 S2", "Y3 S1", "Y3 S2"]);
    expect(terms.filter((t) => t.disabled).map((t) => [t.key, t.reason])).toEqual([["Y1-S1", "full"]]);
    const move = pickerTerms(s.plan, s.plan.entries[4]);
    expect(move.filter((t) => t.disabled).map((t) => [t.key, t.reason])).toEqual([["Y1-S1", "full"], ["Y2-S1", "current"]]);
  });
});

describe("Text view sentence", () => {
  it("lists each requisite with its state and the incompatibles", () => {
    const s = stateFor([["COMP2100", 2, "S1"]]);
    const text = courseSentence("COMP2100", cat, s);
    expect(text).toMatch(/^COMP2100 needs: .*COMP1110.*\(missing\); .*MATH.*\(missing\)\./);
    expect(text).toContain("Can't be taken with COMP6442.");
  });
});

describe("route: /graph/", () => {
  it("is a permanent redirect to the planner's graph view", async () => {
    const res = await fetch(new URL("/graph/", inject("baseUrl")), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/?view=graph");
  });
});

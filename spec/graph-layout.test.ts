import { describe, expect, it } from "vitest";
import { computeDepths, courseEdges, edgeStatus, layoutGraph } from "../src/lib/graph-layout";
import { seedCourses, seedRequisiteNodes } from "../src/lib/seed-data";

describe("graph layout", () => {
  it("derives exactly the COURSE-kind edges in the seed data", () => {
    const edges = courseEdges(seedRequisiteNodes).map((e) => `${e.from}->${e.to}:${e.junction}`);
    expect(edges.sort()).toEqual(
      ["COMP1130->COMP1140:null", "COMP1100->COMP2100:OR", "COMP1140->COMP2100:OR", "COMP1600->COMP3600:OR"].sort(),
    );
  });

  it("layers by longest path", () => {
    const d = computeDepths(["A", "B", "C", "D"], [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "A", to: "C" },
    ]);
    expect(Object.fromEntries(d)).toEqual({ A: 0, B: 1, C: 2, D: 0 });
  });

  it("throws on a cycle", () => {
    expect(() => computeDepths(["A", "B"], [{ from: "A", to: "B" }, { from: "B", to: "A" }])).toThrow(/cycle/);
  });

  it("colours edges by plan state", () => {
    expect(edgeStatus("COMP1130", "COMP1140", [])).toBe("pending");
    expect(edgeStatus("COMP1130", "COMP1140", [{ id: 1, courseCode: "COMP1140", termIndex: 1 }])).toBe("unmet");
    const plan = [
      { id: 1, courseCode: "COMP1130", termIndex: 0 },
      { id: 2, courseCode: "COMP1140", termIndex: 1 },
    ];
    expect(edgeStatus("COMP1130", "COMP1140", plan)).toBe("satisfied");
    expect(edgeStatus("COMP1130", "COMP1140", [{ ...plan[0], termIndex: 1 }, plan[1]])).toBe("unmet");
  });

  it("places COMP2100 two columns right of COMP1130 on the seed data", () => {
    const layout = layoutGraph(seedCourses, seedRequisiteNodes, []);
    const depth = (c: string) => layout.nodes.find((n) => n.code === c)?.depth;
    expect([depth("COMP1130"), depth("COMP1140"), depth("COMP2100"), depth("COMP3600")]).toEqual([0, 1, 2, 1]);
  });

  it("does not mark an OR branch unmet when a sibling branch satisfies the group", () => {
    const plan = [
      { id: 1, courseCode: "COMP1130", termIndex: 0 },
      { id: 2, courseCode: "COMP1140", termIndex: 1 },
      { id: 3, courseCode: "COMP2100", termIndex: 2 },
    ];
    const status = (from: string) =>
      layoutGraph(seedCourses, seedRequisiteNodes, plan).edges.find((e) => e.from === from && e.to === "COMP2100")
        ?.status;
    expect(status("COMP1140")).toBe("satisfied");
    expect(status("COMP1100")).toBe("pending");
  });

  it("still marks every OR branch unmet when no branch is satisfied", () => {
    const plan = [{ id: 1, courseCode: "COMP2100", termIndex: 0 }];
    const edges = layoutGraph(seedCourses, seedRequisiteNodes, plan).edges.filter((e) => e.to === "COMP2100");
    expect(edges.map((e) => e.status)).toEqual(["unmet", "unmet"]);
  });
});

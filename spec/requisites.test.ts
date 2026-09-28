import { describe, expect, it } from "vitest";
import { isSatisfied } from "../src/lib/requisites";
import { seedCourses, seedIncompatibilities, seedRequisiteNodes } from "../src/lib/seed-data";

// Pure unit tests against the real seeded rules --- no DB, no running app.
// This is the logic a bug in would silently mis-validate a real plan, so
// it's the part actually worth testing.

describe("isSatisfied", () => {
  it("has no requisites to satisfy for a course with none", () => {
    const result = isSatisfied("COMP1100", 0, seedRequisiteNodes, seedIncompatibilities, seedCourses, []);
    expect(result).toEqual({ requisitesSatisfied: true, blockedBy: null });
  });

  it("is unsatisfied for a single-course requisite before it's planned", () => {
    const result = isSatisfied("COMP1140", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, []);
    expect(result.requisitesSatisfied).toBe(false);
  });

  it("is satisfied once the required course is planned in an earlier term", () => {
    const plan = [{ id: 1, courseCode: "COMP1130", termIndex: 0 }];
    const result = isSatisfied("COMP1140", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, plan);
    expect(result.requisitesSatisfied).toBe(true);
  });

  it("does not count a course planned in the same or a later term", () => {
    const sameTerm = [{ id: 1, courseCode: "COMP1130", termIndex: 1 }];
    expect(
      isSatisfied("COMP1140", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, sameTerm)
        .requisitesSatisfied,
    ).toBe(false);
  });

  it("COMP2100 needs an intro course OR COMP1140 AND 6 units of MATH", () => {
    const introOnly = [{ id: 1, courseCode: "COMP1100", termIndex: 0 }];
    expect(
      isSatisfied("COMP2100", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, introOnly)
        .requisitesSatisfied,
    ).toBe(false);

    const introAndMath = [
      { id: 1, courseCode: "COMP1100", termIndex: 0 },
      { id: 2, courseCode: "MATH1013", termIndex: 0 },
    ];
    expect(
      isSatisfied("COMP2100", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, introAndMath)
        .requisitesSatisfied,
    ).toBe(true);

    const advancedIntroAndMath = [
      { id: 1, courseCode: "COMP1130", termIndex: 0 },
      { id: 2, courseCode: "COMP1140", termIndex: 1 },
      { id: 3, courseCode: "MATH1013", termIndex: 0 },
    ];
    expect(
      isSatisfied("COMP2100", 2, seedRequisiteNodes, seedIncompatibilities, seedCourses, advancedIntroAndMath)
        .requisitesSatisfied,
    ).toBe(true);
  });

  it("COMP3600 needs the unit-count branch to actually sum units correctly", () => {
    const notEnoughUnits = [
      { id: 1, courseCode: "COMP1100", termIndex: 0 },
      { id: 2, courseCode: "MATH1013", termIndex: 0 },
    ];
    expect(
      isSatisfied("COMP3600", 1, seedRequisiteNodes, seedIncompatibilities, seedCourses, notEnoughUnits)
        .requisitesSatisfied,
    ).toBe(false);

    const twentyFourCompPlusMath = [
      { id: 1, courseCode: "COMP1100", termIndex: 0 },
      { id: 2, courseCode: "COMP1130", termIndex: 0 },
      { id: 3, courseCode: "COMP1140", termIndex: 1 },
      { id: 4, courseCode: "COMP2100", termIndex: 1 },
      { id: 5, courseCode: "MATH1013", termIndex: 0 },
    ];
    expect(
      isSatisfied("COMP3600", 2, seedRequisiteNodes, seedIncompatibilities, seedCourses, twentyFourCompPlusMath)
        .requisitesSatisfied,
    ).toBe(true);

    // Same 24 COMP units, but via COMP1600 instead of 6 units of MATH ---
    // the OR branch's other leaf.
    const twentyFourCompPlusComp1600 = [
      { id: 1, courseCode: "COMP1100", termIndex: 0 },
      { id: 2, courseCode: "COMP1130", termIndex: 0 },
      { id: 3, courseCode: "COMP1140", termIndex: 1 },
      { id: 4, courseCode: "COMP2100", termIndex: 1 },
      { id: 5, courseCode: "COMP1600", termIndex: 0 },
    ];
    expect(
      isSatisfied(
        "COMP3600",
        2,
        seedRequisiteNodes,
        seedIncompatibilities,
        seedCourses,
        twentyFourCompPlusComp1600,
      ).requisitesSatisfied,
    ).toBe(true);
  });

  it("flags an incompatibility regardless of which term the blocker is in", () => {
    const plan = [{ id: 1, courseCode: "COMP1130", termIndex: 3 }];
    const result = isSatisfied("COMP1100", 0, seedRequisiteNodes, seedIncompatibilities, seedCourses, plan);
    expect(result.blockedBy).toBe("COMP1130");
  });
});

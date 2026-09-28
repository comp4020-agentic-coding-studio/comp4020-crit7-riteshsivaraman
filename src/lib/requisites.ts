import type { Course, Incompatibility, PlanEntry, RequisiteNode } from "./schema";

// Pure and DB-free on purpose: this is the logic actually worth testing ---
// a bug here would silently mis-validate a real plan --- so it takes plain
// arrays in and returns plain values out.

export function evaluateNode(
  node: RequisiteNode,
  childrenByParentId: Map<number, RequisiteNode[]>,
  plannedBefore: Set<string>,
  unitsBeforeBySubject: Map<string, number>,
): boolean {
  switch (node.kind) {
    case "COURSE":
      return node.refCourseCode !== null && plannedBefore.has(node.refCourseCode);
    case "UNIT_COUNT":
      return (unitsBeforeBySubject.get(node.unitSubject ?? "") ?? 0) >= (node.unitCount ?? 0);
    case "AND": {
      const children = childrenByParentId.get(node.id) ?? [];
      return (
        children.length > 0 &&
        children.every((child) => evaluateNode(child, childrenByParentId, plannedBefore, unitsBeforeBySubject))
      );
    }
    case "OR": {
      const children = childrenByParentId.get(node.id) ?? [];
      return children.some((child) => evaluateNode(child, childrenByParentId, plannedBefore, unitsBeforeBySubject));
    }
    default:
      throw new Error(`unknown requisite node kind: ${node.kind}`);
  }
}

export interface SatisfactionResult {
  requisitesSatisfied: boolean;
  // The blocking course's code, or null if no incompatibility is violated.
  blockedBy: string | null;
}

export function isSatisfied(
  courseCode: string,
  termIndex: number,
  allNodes: RequisiteNode[],
  allIncompatibilities: Incompatibility[],
  allCourses: Course[],
  planEntries: PlanEntry[],
): SatisfactionResult {
  const plannedBefore = new Set(
    planEntries.filter((entry) => entry.termIndex < termIndex).map((entry) => entry.courseCode),
  );
  const plannedAny = new Set(planEntries.map((entry) => entry.courseCode));

  const courseByCode = new Map(allCourses.map((course) => [course.code, course] as const));
  const unitsBeforeBySubject = new Map<string, number>();
  for (const code of plannedBefore) {
    const course = courseByCode.get(code);
    if (!course) continue;
    unitsBeforeBySubject.set(course.subject, (unitsBeforeBySubject.get(course.subject) ?? 0) + course.units);
  }

  const nodesForCourse = allNodes.filter((node) => node.courseCode === courseCode);
  const childrenByParentId = new Map<number, RequisiteNode[]>();
  for (const node of nodesForCourse) {
    if (node.parentId === null) continue;
    const siblings = childrenByParentId.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(node.parentId, siblings);
  }
  const root = nodesForCourse.find((node) => node.parentId === null);
  const requisitesSatisfied = root
    ? evaluateNode(root, childrenByParentId, plannedBefore, unitsBeforeBySubject)
    : true;

  const violated = allIncompatibilities.find(
    (incompat) => incompat.courseCode === courseCode && plannedAny.has(incompat.blockedByCode),
  );

  return { requisitesSatisfied, blockedBy: violated?.blockedByCode ?? null };
}

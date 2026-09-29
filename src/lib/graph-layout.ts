import type { Course, PlanEntry, RequisiteNode } from "./schema";

// Pure layout for the requisite graph: longest-path layering over
// COURSE-kind requisite leaves. No DB, no DOM --- plain arrays in, plain
// geometry out, so it's unit-testable.

export type EdgeStatus = "satisfied" | "pending" | "unmet";

export interface GraphEdge {
  from: string; // prerequisite course
  to: string; // dependent course
  // The AND/OR node directly above this leaf, if any (for the junction label).
  junction: "AND" | "OR" | null;
  // Id of that AND/OR node (null for a bare root COURSE requisite).
  groupId: number | null;
  status: EdgeStatus;
}

export interface PositionedNode {
  code: string;
  title: string;
  depth: number;
  row: number;
  x: number;
  y: number;
  // Non-course requisites (unit counts) shown as text on the node.
  extraRules: string[];
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export const NODE_W = 150;
export const NODE_H = 56;
const COL_GAP = 80;
const ROW_GAP = 24;
const PAD = 16;

export function courseEdges(nodes: RequisiteNode[]): Omit<GraphEdge, "status">[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return nodes
    .filter((n) => n.kind === "COURSE" && n.refCourseCode !== null)
    .map((n) => {
      const parent = n.parentId === null ? undefined : byId.get(n.parentId);
      const junction = parent && (parent.kind === "AND" || parent.kind === "OR") ? parent.kind : null;
      return { from: n.refCourseCode as string, to: n.courseCode, junction, groupId: junction ? n.parentId : null };
    });
}

// depth = 0 for a course with no course prerequisites, else
// 1 + max(depth of its prerequisites). Throws on a cycle.
export function computeDepths(codes: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const prereqs = new Map<string, string[]>();
  for (const e of edges) prereqs.set(e.to, [...(prereqs.get(e.to) ?? []), e.from]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (code: string): number => {
    const known = depth.get(code);
    if (known !== undefined) return known;
    if (visiting.has(code)) throw new Error(`requisite cycle at ${code}`);
    visiting.add(code);
    const d = Math.max(-1, ...(prereqs.get(code) ?? []).map(visit)) + 1;
    visiting.delete(code);
    depth.set(code, d);
    return d;
  };
  for (const c of codes) visit(c);
  return depth;
}

// An edge is satisfied if the prerequisite is planned in a term strictly
// before the dependent's earliest planned term; unmet if the dependent is
// planned but the prerequisite isn't before it; pending if the dependent
// isn't planned at all.
export function edgeStatus(from: string, to: string, plan: PlanEntry[]): EdgeStatus {
  const earliest = (code: string) => {
    const terms = plan.filter((p) => p.courseCode === code).map((p) => p.termIndex);
    return terms.length ? Math.min(...terms) : null;
  };
  const toTerm = earliest(to);
  if (toTerm === null) return "pending";
  const fromTerm = earliest(from);
  return fromTerm !== null && fromTerm < toTerm ? "satisfied" : "unmet";
}

export function layoutGraph(courses: Course[], nodes: RequisiteNode[], plan: PlanEntry[]): GraphLayout {
  const codes = courses.map((c) => c.code).sort();
  const raw = courseEdges(nodes).filter((e) => codes.includes(e.from) && codes.includes(e.to));
  const depths = computeDepths(codes, raw);
  const rows = new Map<number, number>();
  const positioned = codes.map((code) => {
    const course = courses.find((c) => c.code === code) as Course;
    const d = depths.get(code) ?? 0;
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    const extraRules = nodes
      .filter((n) => n.courseCode === code && n.kind === "UNIT_COUNT")
      .map((n) => `${n.unitCount}u ${n.unitSubject}`);
    return {
      code,
      title: course.title,
      depth: d,
      row,
      x: PAD + d * (NODE_W + COL_GAP),
      y: PAD + row * (NODE_H + ROW_GAP),
      extraRules,
    };
  });
  const maxDepth = Math.max(0, ...positioned.map((n) => n.depth));
  const maxRows = Math.max(1, ...rows.values());
  return {
    nodes: positioned,
    edges: resolveOrGroups(raw.map((e) => ({ ...e, status: edgeStatus(e.from, e.to, plan) }))),
    width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
    height: PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP,
  };
}

// OR groups are judged as a group: once any branch is satisfied, the other
// branches aren't needed, so they drop from "unmet" to "pending" rather than
// showing red. AND groups (and bare requisites) stay per-edge.
export function resolveOrGroups(edges: GraphEdge[]): GraphEdge[] {
  const satisfiedOrGroups = new Set(
    edges.filter((e) => e.junction === "OR" && e.status === "satisfied").map((e) => e.groupId),
  );
  return edges.map((e) =>
    e.junction === "OR" && e.status === "unmet" && satisfiedOrGroups.has(e.groupId) ? { ...e, status: "pending" } : e,
  );
}

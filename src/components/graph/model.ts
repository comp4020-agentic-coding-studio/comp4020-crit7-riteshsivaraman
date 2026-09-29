// Graph model (PLAN.md §4.4 "Graph view"): pure functions from the embedded
// catalogue + PlannerState to the nodes/edges the graph draws, the hover
// neighbourhood, the SemesterPicker term list and the Text view sentences.
// No DOM, no d3 --- spec/graph-model.test.ts pins all of it.
// Browser code (ships in the GraphView chunk) --- reads no environment variables.

import { SLOTS, type CatalogueIndex, type ClauseResult, type Plan, type PlanEntry, type PlannerState, type PlanPeriod, type Rule, type TermKey, type TriState } from "../../lib/contracts";
import { firstFreeSlot, planTerms, termKey } from "../../lib/engine";

export type NodeKind = "course" | "or" | "and" | "units";
export type EdgeKind = "prereq" | "coreq" | "incompatible";
export type EdgeState = "met" | "unmet" | "idle";

export interface GraphNode {
  id: string; // course code for course nodes; "or:<owner>:<path>" etc. for hubs
  kind: NodeKind;
  label: string;
  /** course nodes: in the plan (full node) vs referenced only (ghost) */
  planned: boolean;
  level: number; // drives the left-to-right forceX; hubs take their owner's level
  entryId?: number;
  term?: TermKey;
  status?: "ok" | "warning" | "violation";
  /** ⓘ = the rule has an INFO clause; ? = an UNMODELLED clause */
  badge?: "info" | "unmodelled";
  title?: string;
}

export interface GraphEdge {
  id: string;
  source: string; // for prereq/coreq: the requisite (arrow tail)
  target: string; // ... and the course or hub that needs it (arrowhead)
  kind: EdgeKind;
  state: EdgeState;
  /** incompatible only: both ends planned (a live clash) */
  clash?: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const levelOf = (code: string) => {
  const m = /(\d)\d{3}/.exec(code);
  return m ? Number(m[1]) * 1000 : 1000;
};

export function unitsLabel(rule: Extract<Rule, { kind: "UNITS" }>): string {
  if (rule.from) return `${rule.min}u from ${rule.from.length} course${rule.from.length === 1 ? "" : "s"}`;
  const parts = [
    rule.levels?.length ? `${rule.levels.join("/")}-level` : "",
    rule.subject ?? "",
  ].filter(Boolean);
  return `${rule.min}u · ${parts.length ? parts.join(" ") : "any course"}`;
}

/** An edge into a node inside an OR goes idle (not red) once that OR is met. */
function edgeState(state: TriState | undefined, parentOrMet: boolean): EdgeState {
  if (state === "met") return "met";
  if (state === "unmet") return parentOrMet ? "idle" : "unmet";
  return "idle";
}

export interface GraphOptions {
  /** false: skip ghosts that are only in the graph because a planned course is
   *  incompatible with them, and ghost-to-ghost incompatible edges. Requisite
   *  ghosts and any clash touching a planned course stay. */
  incompatibleGhosts?: boolean;
}

export function buildGraph(cat: CatalogueIndex, state: PlannerState, opts: GraphOptions = {}): GraphModel {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const entries = state.plan.entries;
  const planned = new Map(entries.map((e) => [e.code, e] as const));

  const courseNode = (code: string): GraphNode => {
    let n = nodes.get(code);
    if (!n) {
      const course = cat.byCode.get(code);
      const entry = planned.get(code);
      n = {
        id: code,
        kind: "course",
        label: code,
        planned: !!entry,
        level: course?.level ?? levelOf(code),
        title: course?.title,
      };
      if (entry) {
        n.entryId = entry.id;
        n.term = termKey(entry.year, entry.period);
        n.status = state.evaluation.entries[entry.id]?.state ?? "ok";
      }
      nodes.set(code, n);
    }
    return n;
  };
  const addEdge = (e: GraphEdge) => {
    if (!edges.has(e.id)) edges.set(e.id, e);
  };

  // Planned courses first, so a planned course referenced by another is never a ghost.
  for (const e of entries) courseNode(e.code);

  for (const entry of entries) {
    const owner = courseNode(entry.code);
    const course = cat.byCode.get(entry.code);
    if (!course?.rule) continue;
    const clauses = state.evaluation.entries[entry.id]?.clauses ?? null;

    const expand = (rule: Rule, clause: ClauseResult | null, target: string, path: string, parentOrMet: boolean, top: boolean) => {
      const st = clause?.state;
      switch (rule.kind) {
        case "COURSE": {
          if (rule.code === entry.code) return;
          courseNode(rule.code);
          const kind: EdgeKind = rule.concurrent ? "coreq" : "prereq";
          addEdge({ id: `${kind}:${rule.code}->${target}`, source: rule.code, target, kind, state: edgeState(st, parentOrMet) });
          return;
        }
        case "UNITS": {
          const id = `units:${entry.code}:${path}`;
          nodes.set(id, { id, kind: "units", label: unitsLabel(rule), planned: false, level: owner.level });
          addEdge({ id: `prereq:${id}->${target}`, source: id, target, kind: "prereq", state: edgeState(st, parentOrMet) });
          for (const code of rule.from ?? []) {
            if (code === entry.code) continue;
            courseNode(code);
            const kind: EdgeKind = rule.concurrent ? "coreq" : "prereq";
            addEdge({ id: `${kind}:${code}->${id}`, source: code, target: id, kind, state: planned.has(code) ? "met" : "idle" });
          }
          return;
        }
        case "AND": {
          // At the top (or inside another AND) separate arrows ARE the AND;
          // an AND that is one alternative of an OR needs its own hub.
          let into = target;
          if (!top) {
            into = `and:${entry.code}:${path}`;
            nodes.set(into, { id: into, kind: "and", label: "ALL", planned: false, level: owner.level });
            addEdge({ id: `prereq:${into}->${target}`, source: into, target, kind: "prereq", state: edgeState(st, parentOrMet) });
          }
          rule.children.forEach((c, i) => expand(c, clause?.children?.[i] ?? null, into, `${path}.${i}`, false, top));
          return;
        }
        case "OR": {
          const id = `or:${entry.code}:${path}`;
          nodes.set(id, { id, kind: "or", label: "OR", planned: false, level: owner.level });
          addEdge({ id: `prereq:${id}->${target}`, source: id, target, kind: "prereq", state: edgeState(st, parentOrMet) });
          rule.children.forEach((c, i) => expand(c, clause?.children?.[i] ?? null, id, `${path}.${i}`, st === "met", false));
          return;
        }
        case "INFO":
          owner.badge ??= "info";
          return;
        case "UNMODELLED":
          owner.badge = "unmodelled";
          return;
      }
    };
    expand(course.rule, clauses, entry.code, "r", false, true);
  }

  // Incompatibles: every planned course's list adds ghosts (unless hidden); then one
  // undirected edge per pair among the visible course nodes.
  if (opts.incompatibleGhosts ?? true) {
    for (const e of entries) for (const code of cat.byCode.get(e.code)?.incompatible ?? []) courseNode(code);
  }
  for (const n of [...nodes.values()]) {
    if (n.kind !== "course") continue;
    for (const other of cat.byCode.get(n.id)?.incompatible ?? []) {
      const m = nodes.get(other);
      if (!m || m.kind !== "course" || other === n.id) continue;
      if (!(opts.incompatibleGhosts ?? true) && !n.planned && !m.planned) continue;
      const [a, b] = [n.id, other].sort();
      const clash = n.planned && m.planned;
      addEdge({ id: `incompatible:${a}--${b}`, source: a, target: b, kind: "incompatible", state: clash ? "unmet" : "idle", clash });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * The hover/focus neighbourhood of a node: what it needs (upstream, through
 * hubs), what it unlocks (downstream, through hubs) and what it clashes with.
 */
export function neighbourhood(model: GraphModel, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edgeIds = new Set<string>();
  const isHub = (nid: string) => !model.nodes.find((n) => n.id === nid && n.kind === "course");
  const walk = (from: string, dir: "up" | "down") => {
    for (const e of model.edges) {
      if (e.kind === "incompatible") continue;
      const next = dir === "up" ? (e.target === from ? e.source : null) : e.source === from ? e.target : null;
      if (next === null || edgeIds.has(e.id)) continue;
      edgeIds.add(e.id);
      nodes.add(next);
      if (isHub(next)) walk(next, dir);
    }
  };
  walk(id, "up");
  walk(id, "down");
  for (const e of model.edges) {
    if (e.kind !== "incompatible" || (e.source !== id && e.target !== id)) continue;
    edgeIds.add(e.id);
    nodes.add(e.source === id ? e.target : e.source);
  }
  return { nodes, edges: edgeIds };
}

// ---------------------------------------------------------------------------
// SemesterPicker terms
// ---------------------------------------------------------------------------

export interface PickerTerm {
  year: number;
  period: PlanPeriod;
  key: TermKey;
  label: string; // "Y1 S1", "Y2 Summer"
  free: number;
  disabled: boolean;
  reason: "full" | "current" | null;
}

export const periodLabel = (p: PlanPeriod) => (p === "SUMMER" ? "Summer" : p);
export const termLabel = (year: number, period: PlanPeriod) => `Y${year} ${periodLabel(period)}`;
export const termLongLabel = (year: number, period: PlanPeriod) =>
  `Year ${year}, ${period === "SUMMER" ? "Summer" : `Semester ${period.slice(1)}`}`;

/** Every placeable term; full ones disabled; for a move, the entry's own term too. */
export function pickerTerms(plan: Plan, moving?: PlanEntry): PickerTerm[] {
  return planTerms(plan).map(({ year, period }) => {
    const used = plan.entries.filter((e) => e.year === year && e.period === period).length;
    const current = !!moving && moving.year === year && moving.period === period;
    const full = firstFreeSlot(plan, year, period) === null;
    return {
      year,
      period,
      key: termKey(year, period),
      label: termLabel(year, period),
      free: SLOTS[period] - used,
      disabled: current || full,
      reason: current ? "current" : full ? "full" : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Text view
// ---------------------------------------------------------------------------

const STATE_WORD: Record<TriState, string> = { met: "met", unmet: "missing", unknown: "not checked" };

/** "COMP2100 needs: COMP1110 or COMP1140 (met); 6 units of 1000-level MATH (missing). Can't be taken with COMP6442." */
export function courseSentence(code: string, cat: CatalogueIndex, state: PlannerState): string {
  const course = cat.byCode.get(code);
  const entry = state.plan.entries.find((e) => e.code === code);
  const clauses = entry ? state.evaluation.entries[entry.id]?.clauses ?? null : null;
  const parts: string[] = [];
  if (clauses) {
    const list = clauses.rule.kind === "AND" && clauses.children ? clauses.children : [clauses];
    parts.push(`${code} needs: ${list.map((c) => `${c.english} (${STATE_WORD[c.state]})`).join("; ")}.`);
  } else if (course?.rule) {
    parts.push(`${code} has requisites.`);
  } else {
    parts.push(`${code} has no requisites.`);
  }
  const inc = course?.incompatible ?? [];
  if (inc.length) {
    const plannedCodes = new Set(state.plan.entries.map((e) => e.code));
    parts.push(`Can't be taken with ${inc.map((c) => (plannedCodes.has(c) ? `${c} (in your plan)` : c)).join(", ")}.`);
  }
  return parts.join(" ");
}

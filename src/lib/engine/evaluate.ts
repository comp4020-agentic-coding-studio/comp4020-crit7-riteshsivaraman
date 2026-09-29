// Plan evaluation (PLAN.md §3.1 "Evaluation semantics"). Ports v1's
// requisites.ts behaviour (strictly-earlier COURSE, subject unit counts,
// AND/OR, incompatibility in any term) onto the v2 Rule tree and adds
// corequisites, level/list-scoped units, INFO and UNMODELLED tri-state.
//
// Browser-safe: no node: imports, no DB, no environment variables.

import type {
  CatalogueCourse,
  CatalogueIndex,
  ClauseResult,
  EntryStatus,
  InfoKind,
  Issue,
  Plan,
  PlanEntry,
  PlanEvaluation,
  PlanPeriod,
  PlacementPreview,
  Rule,
  TermKey,
  TriState,
} from "../contracts";
import { describeRule, fitShort, missingShort } from "./describe";
import { planTerms, termKey, termOrder } from "./terms";

interface Placed {
  code: string;
  order: number;
}

interface Ctx {
  self: string;
  order: number;
  placed: Placed[];
  cat: CatalogueIndex;
}

function counts(p: Placed, ctx: Ctx, concurrent: boolean): boolean {
  if (p.code === ctx.self) return false; // a course never counts toward itself
  return concurrent ? p.order <= ctx.order : p.order < ctx.order;
}

function subjectOf(code: string, course: CatalogueCourse | undefined): string {
  return course?.subject ?? code.slice(0, 4);
}

function levelOf(code: string, course: CatalogueCourse | undefined): number {
  return course?.level ?? Math.floor(Number(code.slice(4)) / 1000) * 1000;
}

function and(states: TriState[]): TriState {
  if (states.includes("unmet")) return "unmet";
  if (states.includes("unknown")) return "unknown";
  return "met";
}

function or(states: TriState[]): TriState {
  if (states.includes("met")) return "met";
  if (states.includes("unknown")) return "unknown";
  return "unmet";
}

export function evalRule(rule: Rule, ctx: Ctx): ClauseResult {
  const english = describeRule(rule, ctx.cat);
  switch (rule.kind) {
    case "COURSE": {
      const met = ctx.placed.some((p) => p.code === rule.code && counts(p, ctx, rule.concurrent));
      return { rule, state: met ? "met" : "unmet", english };
    }
    case "UNITS": {
      let total = 0;
      for (const p of ctx.placed) {
        if (!counts(p, ctx, rule.concurrent)) continue;
        const course = ctx.cat.byCode.get(p.code);
        if (rule.from) {
          if (!rule.from.includes(p.code)) continue;
        } else {
          if (rule.subject && subjectOf(p.code, course) !== rule.subject) continue;
          if (rule.levels && !rule.levels.includes(levelOf(p.code, course))) continue;
        }
        total += course?.units ?? 0;
      }
      return { rule, state: total >= rule.min ? "met" : "unmet", english };
    }
    case "AND":
    case "OR": {
      const children = rule.children.map((c) => evalRule(c, ctx));
      const states = children.map((c) => c.state);
      return { rule, state: rule.kind === "AND" ? and(states) : or(states), english, children };
    }
    case "INFO":
      return { rule, state: "met", english };
    case "UNMODELLED":
      return { rule, state: "unknown", english };
  }
}

/** The part of an unmet clause tree that is actually missing. */
function missingOf(result: ClauseResult): Rule {
  if (result.rule.kind === "AND" && result.children) {
    const unmet = result.children.filter((c) => c.state === "unmet").map(missingOf);
    if (unmet.length === 1) return unmet[0]!;
    return { kind: "AND", children: unmet };
  }
  return result.rule;
}

function collect(result: ClauseResult, kind: "INFO" | "UNMODELLED", out: ClauseResult[]): void {
  if (result.rule.kind === kind) out.push(result);
  for (const c of result.children ?? []) collect(c, kind, out);
}

const INFO_SHORT: Record<InfoKind, string> = {
  PERMISSION: "Permission code may be needed",
  PROGRAM: "Program restriction applies",
  GRADE: "Grade requirement applies",
};

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

function statusFor(
  entryId: number,
  code: string,
  year: number,
  period: PlanPeriod,
  placed: (Placed & { entryId: number })[],
  cat: CatalogueIndex,
): EntryStatus {
  const issues: Issue[] = [];
  const course = cat.byCode.get(code);
  let clauses: ClauseResult | null = null;

  if (!course || course.retired) {
    issues.push({ kind: "RETIRED", severity: "warning", short: "No longer in catalogue" });
  }

  if (course) {
    const order = termOrder(year, period);
    const others = placed.filter((p) => p.entryId !== entryId);

    if (course.rule) {
      clauses = evalRule(course.rule, { self: code, order, placed: others, cat });
      if (clauses.state === "unmet") {
        const missing = missingOf(clauses);
        issues.push({ kind: "MISSING_REQUISITE", severity: "error", short: missingShort(missing), missing });
      }
      if (clauses.state !== "met") {
        const seen = new Set<string>();
        const unmodelled: ClauseResult[] = [];
        collect(clauses, "UNMODELLED", unmodelled);
        for (const u of unmodelled) {
          if (u.rule.kind !== "UNMODELLED" || seen.has(u.rule.text)) continue;
          seen.add(u.rule.text);
          issues.push({ kind: "UNMODELLED", severity: "warning", short: "Check official requisites", text: u.rule.text });
        }
      }
      const infos: ClauseResult[] = [];
      collect(clauses, "INFO", infos);
      const seenInfo = new Set<string>();
      for (const i of infos) {
        if (i.rule.kind !== "INFO") continue;
        const key = `${i.rule.info}:${i.rule.text}`;
        if (seenInfo.has(key)) continue;
        seenInfo.add(key);
        const short =
          i.rule.info === "GRADE" && i.rule.wam !== undefined
            ? fitShort(`WAM ${i.rule.wam}+ required`, INFO_SHORT.GRADE)
            : INFO_SHORT[i.rule.info];
        issues.push({ kind: "INFO", severity: "info", short, info: i.rule.info, text: i.rule.text });
      }
    }

    const clashes = new Set(others.map((p) => p.code));
    for (const other of course.incompatible) {
      if (clashes.has(other)) {
        issues.push({ kind: "INCOMPATIBLE", severity: "error", short: fitShort(`Incompatible with ${other}`), with: other });
      }
    }

    if (course.offered.length === 0) {
      issues.push({
        kind: "NO_OFFERING_LISTED",
        severity: "warning",
        short: fitShort(`No ${course.catalogueYear} offering listed`, "No offering listed"),
      });
    } else if (!course.offered.includes(period)) {
      issues.push({ kind: "NOT_OFFERED", severity: "warning", short: fitShort(`Not offered in ${period}`), period });
    }
  }

  // stable sort: error, warning, info
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const state = issues.some((i) => i.severity === "error")
    ? "violation"
    : issues.some((i) => i.severity === "warning")
      ? "warning"
      : "ok";
  return { entryId, code, state, issues, clauses };
}

function placedOf(entries: PlanEntry[]): (Placed & { entryId: number })[] {
  return entries.map((e) => ({ entryId: e.id, code: e.code, order: termOrder(e.year, e.period) }));
}

export function evaluatePlan(plan: Plan, cat: CatalogueIndex): PlanEvaluation {
  const placed = placedOf(plan.entries);
  const entries: Record<number, EntryStatus> = {};
  const unitsByTerm = {} as Record<TermKey, number>;
  for (const t of planTerms(plan)) unitsByTerm[termKey(t.year, t.period)] = 0;

  let totalUnits = 0;
  for (const e of plan.entries) {
    entries[e.id] = statusFor(e.id, e.code, e.year, e.period, placed, cat);
    const units = cat.byCode.get(e.code)?.units ?? 0;
    const key = termKey(e.year, e.period);
    unitsByTerm[key] = (unitsByTerm[key] ?? 0) + units;
    totalUnits += units;
  }
  const problemCount = Object.values(entries).filter((s) => s.state !== "ok").length;
  return { entries, unitsByTerm, totalUnits, problemCount, catalogueVersion: cat.version };
}

/**
 * Status `code` would have at (year, period). If the code is already in the
 * plan this previews a move: its current entry stays in the list but, like
 * any same-code entry, never counts toward the course's own requisites.
 */
export function previewPlacement(
  code: string,
  year: number,
  period: PlanPeriod,
  plan: Plan,
  cat: CatalogueIndex,
): PlacementPreview {
  const PREVIEW_ID = -1;
  const placed = placedOf(plan.entries);
  placed.push({ entryId: PREVIEW_ID, code, order: termOrder(year, period) });
  const status = statusFor(PREVIEW_ID, code, year, period, placed, cat);
  return { state: status.state, issues: status.issues };
}

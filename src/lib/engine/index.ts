// Requisite engine public API (PLAN.md §3.1). WAVE 0 STUB: every function
// has its contract signature and throws until track B implements it; track B
// owns this file from Wave 1.
//
// Pure by contract: no `node:` imports, no DB, no environment variables. The server
// runs it against the full catalogue and the islands may run it against the
// embedded neighbourhood, so it must stay browser-safe.

import type {
  CatalogueCourse,
  CatalogueIndex,
  ParseStatus,
  Plan,
  PlanEvaluation,
  PlanPeriod,
  PlacementPreview,
  Rule,
} from "../contracts";

export type {
  CatalogueIndex,
  ClauseResult,
  EntryStatus,
  Issue,
  PlacementPreview,
  PlanEvaluation,
  Severity,
  TermKey,
  TriState,
} from "../contracts";

function notImplemented(name: string): never {
  throw new Error(`engine.${name} is a Wave 0 stub (track B implements it)`);
}

/** Y1S1 < Y1S2 < Y1SUMMER < Y2S1 */
export function termOrder(year: number, period: PlanPeriod): number {
  void year;
  void period;
  return notImplemented("termOrder");
}

export function indexCatalogue(courses: CatalogueCourse[], version: string): CatalogueIndex {
  void courses;
  void version;
  return notImplemented("indexCatalogue");
}

export function evaluatePlan(plan: Plan, cat: CatalogueIndex): PlanEvaluation {
  void plan;
  void cat;
  return notImplemented("evaluatePlan");
}

export function previewPlacement(
  code: string,
  year: number,
  period: PlanPeriod,
  plan: Plan,
  cat: CatalogueIndex,
): PlacementPreview {
  void code;
  void year;
  void period;
  void plan;
  void cat;
  return notImplemented("previewPlacement");
}

/** Reverse index, built in indexCatalogue. */
export function dependentsOf(code: string, cat: CatalogueIndex): string[] {
  void code;
  void cat;
  return notImplemented("dependentsOf");
}

/** Plain English. */
export function describeRule(rule: Rule, cat: CatalogueIndex): string {
  void rule;
  void cat;
  return notImplemented("describeRule");
}

export function parseRequisiteText(raw: string): {
  rule: Rule | null;
  incompatible: string[];
  status: ParseStatus;
} {
  void raw;
  return notImplemented("parseRequisiteText");
}

/**
 * Lowest free slot index in (year, period), or null if the term is full.
 * Does not check that the term exists in the plan (year <= years, SUMMER year
 * in summerYears); callers do. Used by D for graph add/move and by E to
 * disable full semesters (contract changelog, W0).
 */
export function firstFreeSlot(plan: Plan, year: number, period: PlanPeriod): number | null {
  void plan;
  void year;
  void period;
  return notImplemented("firstFreeSlot");
}

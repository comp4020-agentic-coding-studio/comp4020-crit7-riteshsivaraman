// Requisite engine public API (PLAN.md §3.1). Track B owns src/lib/engine/**.
//
// Pure by contract: no `node:` imports, no DB, no environment variables. The server
// runs it against the full catalogue and the islands may run it against the
// embedded neighbourhood, so it must stay browser-safe (spec/requisites.test.ts
// greps every engine file for this).

import type { CatalogueCourse, CatalogueIndex, Rule } from "../contracts";

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

export { termOrder, termKey, planTerms, firstFreeSlot } from "./terms";
export { evaluatePlan, previewPlacement } from "./evaluate";
export { describeRule } from "./describe";
export { parseRequisiteText } from "./parse";

// The reverse index lives beside the CatalogueIndex rather than on it (the
// contract type is { byCode, version }). Built eagerly by indexCatalogue and
// lazily for an index someone assembled by hand.
const dependents = new WeakMap<CatalogueIndex, Map<string, string[]>>();

function referencedCodes(rule: Rule, out: Set<string>): Set<string> {
  switch (rule.kind) {
    case "COURSE":
      out.add(rule.code);
      break;
    case "UNITS":
      for (const c of rule.from ?? []) out.add(c);
      break;
    case "AND":
    case "OR":
      for (const c of rule.children) referencedCodes(c, out);
      break;
  }
  return out;
}

function buildDependents(cat: CatalogueIndex): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const course of cat.byCode.values()) {
    if (!course.rule) continue;
    for (const code of referencedCodes(course.rule, new Set())) {
      if (code === course.code) continue;
      const list = map.get(code) ?? [];
      list.push(course.code);
      map.set(code, list);
    }
  }
  for (const list of map.values()) list.sort();
  dependents.set(cat, map);
  return map;
}

export function indexCatalogue(courses: CatalogueCourse[], version: string): CatalogueIndex {
  const cat: CatalogueIndex = { byCode: new Map(courses.map((c) => [c.code, c] as const)), version };
  buildDependents(cat);
  return cat;
}

/** Courses whose rule names `code` (as a COURSE or in a UNITS `from` list), sorted. */
export function dependentsOf(code: string, cat: CatalogueIndex): string[] {
  const map = dependents.get(cat) ?? buildDependents(cat);
  return [...(map.get(code) ?? [])];
}

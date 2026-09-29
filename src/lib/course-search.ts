// Course search ranking (PLAN.md §3.2). Pure: no DB, no node: imports, no
// process.env --- the caller hands in the catalogue and a preview function, so
// the ranking is unit-testable without a server or the engine.
//
// Tiers: exact code -> code prefix (incl. the number, "1100") -> subject name
// ("mathematics" lists MATH) -> every query word prefixes a title word ->
// title contains the query. Ties: Ready first (only when a term is given),
// then level, then code. Retired courses are never offered.
import type { CatalogueCourse, Plan, PlanPeriod, PlacementPreview, SearchResult, TermKey } from "./contracts";

export interface SearchOptions {
  plan: Plan;
  term: { year: number; period: PlanPeriod } | null;
  limit: number;
  /** previewPlacement for the term; only called when `term` is set. */
  preview: (code: string) => PlacementPreview;
  subjectNames?: ReadonlyMap<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function matchTier(c: CatalogueCourse, rawQuery: string, subjectNames?: ReadonlyMap<string, string>): number | null {
  const compact = rawQuery.toUpperCase().replace(/\s+/g, "");
  if (compact.length === 0) return null;
  if (c.code === compact) return 0;
  if (c.code.startsWith(compact) || (/^\d+$/.test(compact) && String(c.number).startsWith(compact))) return 1;
  const q = norm(rawQuery);
  const name = subjectNames?.get(c.subject);
  if (q.length >= 3 && name && norm(name).startsWith(q)) return 2;
  const title = norm(c.title);
  const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
  const qWords = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (qWords.length > 0 && qWords.every((w) => titleWords.some((t) => t.startsWith(w)))) return 3;
  if (title.includes(q)) return 4;
  return null;
}

function termKey(year: number, period: PlanPeriod): TermKey {
  return `Y${year}-${period}`;
}

export function searchCourses(courses: readonly CatalogueCourse[], q: string, opts: SearchOptions): SearchResult[] {
  const { plan, term, limit } = opts;
  const planned = new Map(plan.entries.map((e) => [e.code, termKey(e.year, e.period)] as const));
  const previews = new Map<string, PlacementPreview>();
  const previewOf = (code: string): PlacementPreview | null => {
    if (!term) return null;
    let p = previews.get(code);
    if (!p) {
      p = opts.preview(code);
      previews.set(code, p);
    }
    return p;
  };
  const ready = (c: CatalogueCourse) => (term && previewOf(c.code)?.state === "ok" ? 0 : 1);
  const byLevelCode = (a: CatalogueCourse, b: CatalogueCourse) => a.level - b.level || a.code.localeCompare(b.code);

  let picked: CatalogueCourse[];
  if (q.trim().length === 0) {
    // Suggestions: courses from the subjects already in the plan (COMP if
    // empty), not yet planned; with a term, only Ready + offered then.
    const subjects = new Set(plan.entries.map((e) => e.code.slice(0, 4)));
    if (subjects.size === 0) subjects.add("COMP");
    picked = courses
      .filter((c) => !c.retired && subjects.has(c.subject) && !planned.has(c.code))
      .filter((c) => !term || c.offered.includes(term.period))
      .sort(byLevelCode);
    if (term) {
      const out: CatalogueCourse[] = [];
      for (const c of picked) {
        if (out.length >= limit) break;
        if (previewOf(c.code)?.state === "ok") out.push(c);
      }
      picked = out;
    }
  } else {
    const tiered: { c: CatalogueCourse; tier: number }[] = [];
    for (const c of courses) {
      if (c.retired) continue;
      const tier = matchTier(c, q, opts.subjectNames);
      if (tier !== null) tiered.push({ c, tier });
    }
    tiered.sort((a, b) => a.tier - b.tier || ready(a.c) - ready(b.c) || byLevelCode(a.c, b.c));
    picked = tiered.map((t) => t.c);
  }

  return picked.slice(0, limit).map((course) => ({
    course,
    preview: previewOf(course.code),
    inPlan: planned.get(course.code) ?? null,
  }));
}
